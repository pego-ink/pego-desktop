import type { Canvas as SkCanvas, Paint, Paragraph } from "canvaskit-wasm";
import type { Box, Layout } from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { createLruCache } from "@/canvas/render-cache";
import { docToScreen, type Camera } from "@/canvas/types";
import { HANDLES, handlePoint } from "@/interaction/transform";

export const ACCENT = "#B79CFF";
const LABEL_TEXT = "#141418";
const HANDLE_SIZE = 8;

export type OverlayState = {
  layout: Layout;
  camera: Camera;
  selection: readonly string[];
  hoveredId: string | null;
  /** Marquee in document coordinates. */
  marquee: Box | null;
  /** Nodes the agent is working on right now (empty when no run is active). */
  agentFocusIds?: readonly string[];
  /** Hide the selection box, handles and size label (e.g. while a path is in pen edit mode). */
  suppressSelection?: boolean;
  /** `performance.now()` for the agent focus animation; omit for a static box (reduced motion). */
  time?: number;
};

const AGENT_FOCUS_FILL = "#B79CFF";
const DASH: number[] = [5, 4];
const DASH_PERIOD = DASH[0]! + DASH[1]!;
/** Dash travel speed (ms per px) and fill pulse period (ms) of the agent focus box. */
const DASH_MS_PER_PX = 70;
const PULSE_PERIOD_MS = 1800;
const FOCUS_FILL_ALPHA = 0.078;
const FOCUS_FILL_PULSE = 0.035;

type Kit = {
  fill: Paint;
  stroke: Paint;
  colors: Map<string, Float32Array>;
  paragraphs: ReturnType<typeof createLruCache<Paragraph>>;
};

const kits = new WeakMap<CanvasKitResources, Kit>();

/** Paints, parsed colors and label paragraphs live for the whole session, not per frame. */
const getKit = (res: CanvasKitResources): Kit => {
  const cached = kits.get(res);
  if (cached) return cached;
  const { ck } = res;
  const make = (style: "fill" | "stroke") => {
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(style === "fill" ? ck.PaintStyle.Fill : ck.PaintStyle.Stroke);
    return paint;
  };
  const kit: Kit = {
    fill: make("fill"),
    stroke: make("stroke"),
    colors: new Map(),
    paragraphs: createLruCache<Paragraph>(64),
  };
  kits.set(res, kit);
  return kit;
};

const colorOf = (res: CanvasKitResources, color: string): Float32Array => {
  const { colors } = getKit(res);
  const cached = colors.get(color);
  if (cached) return cached;
  const parsed = res.ck.parseColorString(color);
  colors.set(color, parsed);
  return parsed;
};

/** Laid-out label paragraph, cached by font size + text (LRU, evicted paragraphs are deleted). */
const getLabel = (res: CanvasKitResources, text: string, fontSize: number): Paragraph => {
  const { paragraphs } = getKit(res);
  const key = `${fontSize}|${text}`;
  const cached = paragraphs.get(key);
  if (cached) return cached;
  const { ck, fontMgr, fontFamily } = res;
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: colorOf(res, LABEL_TEXT),
      fontFamilies: [fontFamily],
      fontSize,
      fontStyle: { weight: { value: 600 } },
    },
  });
  const builder = ck.ParagraphBuilder.Make(style, fontMgr);
  try {
    builder.addText(text);
    const paragraph = builder.build();
    paragraph.layout(1000);
    paragraphs.set(key, paragraph);
    return paragraph;
  } finally {
    builder.delete();
  }
};

const toScreenBox = (camera: Camera, box: Box): Box => ({
  ...docToScreen(camera, box.x, box.y),
  width: box.width * camera.zoom,
  height: box.height * camera.zoom,
});

const strokeRect = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  box: Box,
  color: string,
  width: number,
) => {
  const { stroke } = getKit(res);
  stroke.setStrokeWidth(width);
  stroke.setColor(colorOf(res, color));
  canvas.drawRect(res.ck.XYWHRect(box.x, box.y, box.width, box.height), stroke);
};

const fillRect = (res: CanvasKitResources, canvas: SkCanvas, box: Box, color: string) => {
  const { fill } = getKit(res);
  fill.setColor(colorOf(res, color));
  canvas.drawRect(res.ck.XYWHRect(box.x, box.y, box.width, box.height), fill);
};

const drawHandles = (res: CanvasKitResources, canvas: SkCanvas, box: Box) => {
  for (const handle of HANDLES) {
    const c = handlePoint(box, handle);
    const rect = {
      x: c.x - HANDLE_SIZE / 2,
      y: c.y - HANDLE_SIZE / 2,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    };
    fillRect(res, canvas, rect, "#FFFFFF");
    strokeRect(res, canvas, rect, ACCENT, 1.5);
  }
};

/** Accent pill with `text`; `place` maps the pill size to its top-left corner. */
const drawPill = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  text: string,
  fontSize: number,
  pad: { x: number; y: number },
  place: (width: number, height: number) => { x: number; y: number },
) => {
  const paragraph = getLabel(res, text, fontSize);
  const w = paragraph.getLongestLine() + pad.x * 2;
  const h = paragraph.getHeight() + pad.y * 2;
  const { x, y } = place(w, h);
  const { fill } = getKit(res);
  fill.setColor(colorOf(res, ACCENT));
  canvas.drawRRect(res.ck.RRectXY(res.ck.XYWHRect(x, y, w, h), 4, 4), fill);
  canvas.drawParagraph(paragraph, x + pad.x, y + pad.y);
};

const drawSizeLabel = (res: CanvasKitResources, canvas: SkCanvas, box: Box, docBox: Box) =>
  drawPill(
    res,
    canvas,
    `${Math.round(docBox.width)} × ${Math.round(docBox.height)}`,
    11,
    { x: 6, y: 3 },
    (w) => ({ x: box.x + box.width / 2 - w / 2, y: box.y + box.height + HANDLE_SIZE + 4 }),
  );

/** Small "Agent" pill sitting on the top-left edge of a focused box. */
const drawAgentTag = (res: CanvasKitResources, canvas: SkCanvas, box: Box) =>
  drawPill(res, canvas, "Agent", 10, { x: 6, y: 2 }, (_w, h) => ({ x: box.x, y: box.y - h - 3 }));

const drawAgentFocus = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  layout: Layout,
  camera: Camera,
  ids: readonly string[],
  time: number | undefined,
) => {
  const { ck } = res;
  const { fill, stroke } = getKit(res);
  const animated = time !== undefined;
  const pulse = animated ? 0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / PULSE_PERIOD_MS) : 0.5;
  const dash = ck.PathEffect.MakeDash(DASH, animated ? (time / DASH_MS_PER_PX) % DASH_PERIOD : 0);
  try {
    for (const id of ids) {
      const box = layout.get(id);
      if (!box) continue;
      const screen = toScreenBox(camera, box);
      const rect = ck.XYWHRect(screen.x, screen.y, screen.width, screen.height);
      fill.setColor(colorOf(res, AGENT_FOCUS_FILL));
      fill.setAlphaf(FOCUS_FILL_ALPHA + (pulse - 0.5) * FOCUS_FILL_PULSE);
      canvas.drawRect(rect, fill);
      stroke.setStrokeWidth(1.5);
      stroke.setColor(colorOf(res, ACCENT));
      stroke.setPathEffect(dash);
      canvas.drawRect(rect, stroke);
      stroke.setPathEffect(null);
      drawAgentTag(res, canvas, screen);
    }
  } finally {
    stroke.setPathEffect(null);
    dash.delete();
  }
};

/** Editor chrome in screen space (CSS px; the caller applies the device pixel ratio). */
export const renderOverlay = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  {
    layout,
    camera,
    selection,
    hoveredId,
    marquee,
    agentFocusIds,
    suppressSelection,
    time,
  }: OverlayState,
) => {
  if (agentFocusIds && agentFocusIds.length > 0)
    drawAgentFocus(res, canvas, layout, camera, agentFocusIds, time);

  if (!suppressSelection) {
    if (hoveredId && !selection.includes(hoveredId)) {
      const box = layout.get(hoveredId);
      if (box) strokeRect(res, canvas, toScreenBox(camera, box), ACCENT, 1);
    }

    for (const id of selection) {
      const box = layout.get(id);
      if (box) strokeRect(res, canvas, toScreenBox(camera, box), ACCENT, 1.5);
    }

    const [only] = selection;
    const single = selection.length === 1 && only ? layout.get(only) : undefined;
    if (single) {
      const screen = toScreenBox(camera, single);
      drawHandles(res, canvas, screen);
      drawSizeLabel(res, canvas, screen, single);
    }
  }

  if (marquee) {
    const screen = toScreenBox(camera, marquee);
    fillRect(res, canvas, screen, "#B79CFF1A");
    strokeRect(res, canvas, screen, ACCENT, 1);
  }
};
