import type { Canvas as SkCanvas, Paint, Paragraph, Path } from "canvaskit-wasm";
import type { Box, Layout, PegoDocument } from "@pego/doc";
import type { AgentFocusGroup } from "@/agent/focus-groups";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { buildNodeOutline } from "@/canvas/node-outline";
import { createLruCache } from "@/canvas/render-cache";
import { docToScreen, type Camera } from "@/canvas/types";
import type { Segment } from "@/interaction/drag-target";
import type { Affine } from "@/canvas/node-transform";
import {
  frameAxes,
  frameCorners,
  frameHandlePoint,
  getSelectionFrame,
  labelAnchor,
  toScreenMatrix,
  topmostCorner,
  type SelectionFrame,
} from "@/interaction/selection-frame";
import { HANDLES } from "@/interaction/transform";
import { CAPTION_FONT_SIZE, frameCaptions, type FrameCaption } from "./frame-captions";

export const ACCENT = "#B79CFF";
const LABEL_TEXT = "#141418";
const HANDLE_SIZE = 8;
/** Hover outline width in screen px, constant at every zoom. */
const HOVER_STROKE_WIDTH = 2;
/** Auto-layout insertion line width in screen px. */
const DROP_LINE_WIDTH = 2;

export type OverlayState = {
  doc: PegoDocument;
  layout: Layout;
  camera: Camera;
  selection: readonly string[];
  hoveredId: string | null;
  /** Marquee in document coordinates. */
  marquee: Box | null;
  /** Insertion line in document coordinates while a node is dragged inside an auto-layout frame. */
  dropLine?: Segment | null;
  /** Nodes each running agent is working on right now, one tinted group per run. */
  agentFocus?: readonly AgentFocusGroup[];
  /** Hide the selection box, handles and size label (e.g. while a path is in pen edit mode). */
  suppressSelection?: boolean;
  /** `performance.now()` for the agent focus animation; omit for a static box (reduced motion). */
  time?: number;
  /** The shown page: its top-level frames get name captions. */
  pageId?: string | null;
  /** Canvas theme, for caption colors that read on its background. */
  theme?: "light" | "dark";
};

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
  /** Document-space outline of the last hovered node; rebuilt only when doc, layout or id change. */
  hover: { doc: PegoDocument; layout: Layout; id: string; path: Path | null } | null;
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
    hover: null,
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

/** Caption colors per theme: plain, hovered, components and instances. */
const CAPTION_COLORS = {
  light: { frame: "#6E6E7A", hover: "#18181D", component: "#8B5CF6" },
  dark: { frame: "#9A9AA6", hover: "#E6E6EB", component: "#B79CFF" },
} as const;

/** A one-line caption cut to `width` with an ellipsis (cached like labels). */
const getCaption = (
  res: CanvasKitResources,
  text: string,
  color: string,
  width: number,
): Paragraph => {
  const { paragraphs } = getKit(res);
  // Widths in 8px steps keep the cache small while zooming.
  const room = Math.max(8, Math.floor(width / 8) * 8);
  const key = `caption|${color}|${room}|${text}`;
  const cached = paragraphs.get(key);
  if (cached) return cached;
  const { ck, fontMgr, fontFamily } = res;
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: colorOf(res, color),
      fontFamilies: [fontFamily],
      fontSize: CAPTION_FONT_SIZE,
      fontStyle: { weight: { value: 500 } },
    },
    maxLines: 1,
    ellipsis: "…",
  });
  const builder = ck.ParagraphBuilder.Make(style, fontMgr);
  try {
    builder.addText(text);
    const paragraph = builder.build();
    paragraph.layout(room);
    paragraphs.set(key, paragraph);
    return paragraph;
  } finally {
    builder.delete();
  }
};

/** Name captions above the shown page's top-level frames; the selected ones in the accent. */
const drawCaptions = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  captions: readonly FrameCaption[],
  selection: readonly string[],
  hoveredId: string | null,
  theme: "light" | "dark",
) => {
  const colors = CAPTION_COLORS[theme];
  for (const caption of captions) {
    const color = selection.includes(caption.id)
      ? ACCENT
      : caption.id === hoveredId
        ? colors.hover
        : caption.kind === "frame"
          ? colors.frame
          : colors.component;
    canvas.drawParagraph(getCaption(res, caption.text, color, caption.width), caption.x, caption.y);
  }
};

/** The hovered node's outline, cached across frames so pointer moves do not rebuild paths. */
const getHoverOutline = (
  res: CanvasKitResources,
  doc: PegoDocument,
  layout: Layout,
  id: string,
): Path | null => {
  const kit = getKit(res);
  const cached = kit.hover;
  if (cached && cached.doc === doc && cached.layout === layout && cached.id === id)
    return cached.path;
  cached?.path?.delete();
  const path = buildNodeOutline(res.ck, doc, layout, id);
  kit.hover = { doc, layout, id, path };
  return path;
};

/** Stroke the hovered node's real (transformed) outline at a fixed screen width. */
const drawHover = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
  id: string,
) => {
  const path = getHoverOutline(res, doc, layout, id);
  if (!path) return;
  const { stroke } = getKit(res);
  // The path lives in document space: scale the canvas and divide the width back out so the
  // line stays HOVER_STROKE_WIDTH screen px wide.
  stroke.setStrokeWidth(HOVER_STROKE_WIDTH / camera.zoom);
  stroke.setColor(colorOf(res, ACCENT));
  canvas.save();
  canvas.translate(camera.panX, camera.panY);
  canvas.scale(camera.zoom, camera.zoom);
  canvas.drawPath(path, stroke);
  canvas.restore();
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

/** Run `draw` with the canvas transformed by `m` (local -> screen), then restore. */
const withMatrix = (canvas: SkCanvas, m: Affine, draw: () => void) => {
  canvas.save();
  canvas.concat([m.a, m.c, m.e, m.b, m.d, m.f, 0, 0, 1]);
  draw();
  canvas.restore();
};

/** The node's box as a rotated rectangle: drawn in local space, so the stroke is divided by zoom. */
const drawFrameOutline = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  frame: SelectionFrame,
  screen: Affine,
  zoom: number,
) =>
  withMatrix(canvas, screen, () =>
    strokeRect(
      res,
      canvas,
      { x: 0, y: 0, width: frame.box.width, height: frame.box.height },
      ACCENT,
      1.5 / zoom,
    ),
  );

/** Handles sit on the rotated corners/edges and are squares aligned to the node's axes. */
const drawHandles = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  frame: SelectionFrame,
  screen: Affine,
) => {
  const { ux, uy } = frameAxes(screen);
  const rect = {
    x: -HANDLE_SIZE / 2,
    y: -HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  };
  for (const handle of HANDLES) {
    const c = frameHandlePoint(screen, frame.box.width, frame.box.height, handle);
    withMatrix(canvas, { a: ux.x, b: ux.y, c: uy.x, d: uy.y, e: c.x, f: c.y }, () => {
      fillRect(res, canvas, rect, "#FFFFFF");
      strokeRect(res, canvas, rect, ACCENT, 1.5);
    });
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
  color: string = ACCENT,
) => {
  const paragraph = getLabel(res, text, fontSize);
  const w = paragraph.getLongestLine() + pad.x * 2;
  const h = paragraph.getHeight() + pad.y * 2;
  const { x, y } = place(w, h);
  const { fill } = getKit(res);
  fill.setColor(colorOf(res, color));
  canvas.drawRRect(res.ck.RRectXY(res.ck.XYWHRect(x, y, w, h), 4, 4), fill);
  canvas.drawParagraph(paragraph, x + pad.x, y + pad.y);
};

/** Horizontal size label (the node's own, unrotated size) below the lowest point of the box. */
const drawSizeLabel = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  anchor: { x: number; y: number },
  docBox: Box,
) =>
  drawPill(
    res,
    canvas,
    `${Math.round(docBox.width)} × ${Math.round(docBox.height)}`,
    11,
    { x: 6, y: 3 },
    (w) => ({ x: anchor.x - w / 2, y: anchor.y + HANDLE_SIZE + 4 }),
  );

/** Small pill (the run's session title) sitting above a focused box's topmost corner. */
const drawAgentTag = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  corner: { x: number; y: number },
  label: string,
  color: string,
) =>
  drawPill(
    res,
    canvas,
    label,
    10,
    { x: 6, y: 2 },
    (_w, h) => ({ x: corner.x, y: corner.y - h - 3 }),
    color,
  );

const drawAgentFocus = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
  { ids, color, label }: AgentFocusGroup,
  time: number | undefined,
) => {
  const { ck } = res;
  const { fill, stroke } = getKit(res);
  const { zoom } = camera;
  const animated = time !== undefined;
  const pulse = animated ? 0.5 + 0.5 * Math.sin((time * 2 * Math.PI) / PULSE_PERIOD_MS) : 0.5;
  // The box is drawn in node-local space (scaled by zoom), so dashes are specified in local units.
  const dash = ck.PathEffect.MakeDash(
    DASH.map((v) => v / zoom),
    (animated ? (time / DASH_MS_PER_PX) % DASH_PERIOD : 0) / zoom,
  );
  try {
    for (const id of ids) {
      const frame = getSelectionFrame(doc, layout, id);
      if (!frame) continue;
      const screen = toScreenMatrix(camera, frame.matrix);
      const rect = ck.XYWHRect(0, 0, frame.box.width, frame.box.height);
      withMatrix(canvas, screen, () => {
        fill.setColor(colorOf(res, color));
        fill.setAlphaf(FOCUS_FILL_ALPHA + (pulse - 0.5) * FOCUS_FILL_PULSE);
        canvas.drawRect(rect, fill);
        stroke.setStrokeWidth(1.5 / zoom);
        stroke.setColor(colorOf(res, color));
        stroke.setPathEffect(dash);
        canvas.drawRect(rect, stroke);
        stroke.setPathEffect(null);
      });
      drawAgentTag(
        res,
        canvas,
        topmostCorner(frameCorners(screen, frame.box.width, frame.box.height)),
        label,
        color,
      );
    }
  } finally {
    stroke.setPathEffect(null);
    dash.delete();
  }
};

/** Insertion line between auto-layout siblings, drawn as a fixed-width screen-space stroke. */
const drawDropLine = (res: CanvasKitResources, canvas: SkCanvas, camera: Camera, line: Segment) => {
  const a = docToScreen(camera, line.x1, line.y1);
  const b = docToScreen(camera, line.x2, line.y2);
  const { stroke } = getKit(res);
  stroke.setStrokeWidth(DROP_LINE_WIDTH);
  stroke.setColor(colorOf(res, ACCENT));
  canvas.drawLine(a.x, a.y, b.x, b.y, stroke);
};

/** Editor chrome in screen space (CSS px; the caller applies the device pixel ratio). */
export const renderOverlay = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  {
    doc,
    layout,
    camera,
    selection,
    hoveredId,
    marquee,
    dropLine,
    agentFocus,
    suppressSelection,
    time,
    pageId = null,
    theme = "light",
  }: OverlayState,
) => {
  drawCaptions(
    res,
    canvas,
    frameCaptions(doc, layout, camera, pageId),
    selection,
    hoveredId,
    theme,
  );

  for (const group of agentFocus ?? []) {
    if (group.ids.length > 0) drawAgentFocus(res, canvas, doc, layout, camera, group, time);
  }

  if (!suppressSelection) {
    if (hoveredId && !selection.includes(hoveredId))
      drawHover(res, canvas, doc, layout, camera, hoveredId);

    for (const id of selection) {
      const frame = getSelectionFrame(doc, layout, id);
      if (frame)
        drawFrameOutline(res, canvas, frame, toScreenMatrix(camera, frame.matrix), camera.zoom);
    }

    const [only] = selection;
    const single = selection.length === 1 && only ? getSelectionFrame(doc, layout, only) : null;
    if (single) {
      const screen = toScreenMatrix(camera, single.matrix);
      drawHandles(res, canvas, single, screen);
      const corners = frameCorners(screen, single.box.width, single.box.height);
      drawSizeLabel(res, canvas, labelAnchor(corners), single.box);
    }
  }

  if (dropLine) drawDropLine(res, canvas, camera, dropLine);

  if (marquee) {
    const screen = toScreenBox(camera, marquee);
    fillRect(res, canvas, screen, "#B79CFF1A");
    strokeRect(res, canvas, screen, ACCENT, 1);
  }
};
