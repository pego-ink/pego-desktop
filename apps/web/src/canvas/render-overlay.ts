import type { Canvas as SkCanvas, Paint, Paragraph, Path } from "canvaskit-wasm";
import { findNode, resolveNumber, type Box, type Layout, type PegoDocument } from "@pego/doc";
import { cursorRects } from "@/canvas/agent-cursor-rects";
import type { Rect } from "@/canvas/agent-cursor-motion";
import { boundsOfPoints, placeGeneratingLabel } from "@/canvas/agent-focus-label";
import type { AgentFocusGroup } from "@/agent/focus-groups";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { buildNodeOutline } from "@/canvas/node-outline";
import { getNodeIndex } from "@/interaction/hit-test";
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
  type SelectionFrame,
} from "@/interaction/selection-frame";
import { CORNER_HANDLES } from "@/interaction/transform";
import {
  CAPTION_COLORS,
  HANDLE_FILL,
  MARQUEE_FILL,
  SELECTION,
  SELECTION_LABEL_TEXT,
} from "./chrome-colors";
import { CAPTION_FONT_SIZE, frameCaptions, type FrameCaption } from "./frame-captions";

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
  /** The canvas size in CSS px: captions outside it are not drawn. */
  viewport?: { width: number; height: number };
};

const DASH: number[] = [5, 4];
const DASH_PERIOD = DASH[0]! + DASH[1]!;
/** Dash travel speed (ms per px) of the agent focus outline. */
const DASH_MS_PER_PX = 70;
/** Skeleton wash and highlight-band opacity, and the band's sweep period (ms). */
const SKELETON_BASE_ALPHA = 0.07;
const SKELETON_SHIMMER_ALPHA = 0.16;
const SHIMMER_PERIOD_MS = 1800;
/** "Generating" pill spinner: diameter, gap to the text (px), turn period (ms), arc sweep (deg). */
const SPINNER_SIZE = 8;
const SPINNER_GAP = 5;
const SPINNER_PERIOD_MS = 900;
const SPINNER_SWEEP = 270;

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
    // One per frame caption on screen (a page can have a hundred screens).
    paragraphs: createLruCache<Paragraph>(512),
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
const getLabel = (
  res: CanvasKitResources,
  text: string,
  fontSize: number,
  textColor: string = LABEL_TEXT,
): Paragraph => {
  const { paragraphs } = getKit(res);
  const key = `${textColor}|${fontSize}|${text}`;
  const cached = paragraphs.get(key);
  if (cached) return cached;
  const { ck, fontMgr, fontFamily } = res;
  const style = new ck.ParagraphStyle({
    textStyle: {
      color: colorOf(res, textColor),
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
  viewport: { width: number; height: number } | undefined,
) => {
  const colors = CAPTION_COLORS[theme];
  for (const caption of captions) {
    if (
      viewport &&
      (caption.x > viewport.width ||
        caption.y > viewport.height ||
        caption.x + caption.width < 0 ||
        caption.y + CAPTION_FONT_SIZE * 2 < 0)
    ) {
      continue;
    }
    const color = selection.includes(caption.id)
      ? SELECTION
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
const isConnector = (doc: PegoDocument, id: string): boolean =>
  getNodeIndex(doc).get(id)?.type === "connector";

/** A selected connector: its line traced in the selection color, wider than a hover. */
const drawConnectorSelection = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
  id: string,
) => {
  const path = buildNodeOutline(res.ck, doc, layout, id);
  if (!path) return;
  const { stroke } = getKit(res);
  stroke.setStrokeWidth((HOVER_STROKE_WIDTH * 1.5) / camera.zoom);
  stroke.setColor(colorOf(res, SELECTION));
  canvas.save();
  canvas.translate(camera.panX, camera.panY);
  canvas.scale(camera.zoom, camera.zoom);
  canvas.drawPath(path, stroke);
  canvas.restore();
  path.delete();
};

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
  stroke.setColor(colorOf(res, SELECTION));
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
      SELECTION,
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
  for (const handle of CORNER_HANDLES) {
    const c = frameHandlePoint(screen, frame.box.width, frame.box.height, handle);
    withMatrix(canvas, { a: ux.x, b: ux.y, c: uy.x, d: uy.y, e: c.x, f: c.y }, () => {
      fillRect(res, canvas, rect, HANDLE_FILL);
      strokeRect(res, canvas, rect, SELECTION, 1.5);
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
  color: string = SELECTION,
  textColor: string = SELECTION_LABEL_TEXT,
) => {
  const paragraph = getLabel(res, text, fontSize, textColor);
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

/** Corner radius of the node's box (clamped; ellipses are round) so the skeleton follows its shape. */
const skeletonRadius = (doc: PegoDocument, id: string, width: number, height: number): number => {
  const node = findNode(doc, id);
  if (!node) return 0;
  const max = Math.min(width, height) / 2;
  if (node.type === "ellipse") return max;
  if (node.type === "frame" || node.type === "rectangle" || node.type === "image")
    return Math.min(max, Math.max(0, resolveNumber(node.cornerRadius, doc.variables, 0)));
  return 0;
};

/**
 * Loading skeleton of one focused node (local space): a soft run-tinted wash plus a diagonal
 * highlight band sweeping across it. `time` is the shared canvas clock; without it (reduced
 * motion) only the static wash is drawn.
 */
const drawSkeleton = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  color: string,
  width: number,
  height: number,
  radius: number,
  time: number | undefined,
) => {
  const { ck } = res;
  const { fill } = getKit(res);
  const rect = ck.XYWHRect(0, 0, width, height);
  const tint = colorOf(res, color);
  canvas.save();
  canvas.clipRRect(ck.RRectXY(rect, radius, radius), ck.ClipOp.Intersect, true);
  fill.setColor(tint);
  fill.setAlphaf(SKELETON_BASE_ALPHA);
  canvas.drawRect(rect, fill);
  if (time !== undefined) {
    const length = Math.hypot(width, height) || 1;
    const band = length * 0.5;
    // Band start along the diagonal, as a fraction of its length: sweeps from fully before to after.
    const start =
      -band / length + ((time % SHIMMER_PERIOD_MS) / SHIMMER_PERIOD_MS) * (1 + band / length);
    const end = start + band / length;
    const clear = Float32Array.of(tint[0]!, tint[1]!, tint[2]!, 0);
    const peak = Float32Array.of(tint[0]!, tint[1]!, tint[2]!, SKELETON_SHIMMER_ALPHA);
    const shader = ck.Shader.MakeLinearGradient(
      [width * start, height * start],
      [width * end, height * end],
      [clear, peak, clear],
      [0, 0.5, 1],
      ck.TileMode.Clamp,
    );
    fill.setShader(shader);
    canvas.drawRect(rect, fill);
    fill.setShader(null);
    shader.delete();
  }
  canvas.restore();
};

/** One "Generating" pill per run: spinner + text in the run colour, constant screen size. */
const drawGeneratingLabel = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  union: Rect,
  color: string,
  time: number | undefined,
) => {
  const { ck } = res;
  const { fill, stroke } = getKit(res);
  const paragraph = getLabel(res, "Generating", 10);
  const pad = { x: 6, y: 2 };
  const w = pad.x * 2 + SPINNER_SIZE + SPINNER_GAP + paragraph.getLongestLine();
  const h = paragraph.getHeight() + pad.y * 2;
  const { x, y } = placeGeneratingLabel(union, { width: w, height: h }, cursorRects());
  fill.setColor(colorOf(res, color));
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x, y, w, h), 4, 4), fill);
  const cx = x + pad.x + SPINNER_SIZE / 2;
  const cy = y + h / 2;
  const r = SPINNER_SIZE / 2 - 0.75;
  stroke.setStrokeWidth(1.5);
  stroke.setStrokeCap(ck.StrokeCap.Round);
  stroke.setColor(colorOf(res, LABEL_TEXT));
  canvas.drawArc(
    ck.LTRBRect(cx - r, cy - r, cx + r, cy + r),
    time === undefined ? -90 : ((time / SPINNER_PERIOD_MS) * 360) % 360,
    SPINNER_SWEEP,
    false,
    stroke,
  );
  stroke.setStrokeCap(ck.StrokeCap.Butt);
  canvas.drawParagraph(paragraph, x + pad.x + SPINNER_SIZE + SPINNER_GAP, y + pad.y);
};

const drawAgentFocus = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
  { ids, color }: AgentFocusGroup,
  time: number | undefined,
) => {
  const { ck } = res;
  const { stroke } = getKit(res);
  const { zoom } = camera;
  const animated = time !== undefined;
  // The box is drawn in node-local space (scaled by zoom), so dashes are specified in local units.
  const dash = ck.PathEffect.MakeDash(
    DASH.map((v) => v / zoom),
    (animated ? (time / DASH_MS_PER_PX) % DASH_PERIOD : 0) / zoom,
  );
  const corners: { x: number; y: number }[] = [];
  try {
    for (const id of ids) {
      const frame = getSelectionFrame(doc, layout, id);
      if (!frame) continue;
      const screen = toScreenMatrix(camera, frame.matrix);
      const { width, height } = frame.box;
      corners.push(...frameCorners(screen, width, height));
      const rect = ck.XYWHRect(0, 0, width, height);
      withMatrix(canvas, screen, () => {
        drawSkeleton(
          res,
          canvas,
          color,
          width,
          height,
          skeletonRadius(doc, id, width, height),
          time,
        );
        stroke.setStrokeWidth(1.5 / zoom);
        stroke.setColor(colorOf(res, color));
        stroke.setPathEffect(dash);
        canvas.drawRect(rect, stroke);
        stroke.setPathEffect(null);
      });
    }
  } finally {
    stroke.setPathEffect(null);
    dash.delete();
  }
  const union = boundsOfPoints(corners);
  if (union) drawGeneratingLabel(res, canvas, union, color, time);
};

/** Insertion line between auto-layout siblings, drawn as a fixed-width screen-space stroke. */
const drawDropLine = (res: CanvasKitResources, canvas: SkCanvas, camera: Camera, line: Segment) => {
  const a = docToScreen(camera, line.x1, line.y1);
  const b = docToScreen(camera, line.x2, line.y2);
  const { stroke } = getKit(res);
  stroke.setStrokeWidth(DROP_LINE_WIDTH);
  stroke.setColor(colorOf(res, SELECTION));
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
    viewport,
  }: OverlayState,
) => {
  drawCaptions(
    res,
    canvas,
    frameCaptions(doc, layout, camera, pageId),
    selection,
    hoveredId,
    theme,
    viewport,
  );

  for (const group of agentFocus ?? []) {
    if (group.ids.length > 0) drawAgentFocus(res, canvas, doc, layout, camera, group, time);
  }

  if (!suppressSelection) {
    if (hoveredId && !selection.includes(hoveredId))
      drawHover(res, canvas, doc, layout, camera, hoveredId);

    for (const id of selection) {
      // A connector shows its line highlighted: no box, no handles.
      if (isConnector(doc, id)) {
        drawConnectorSelection(res, canvas, doc, layout, camera, id);
        continue;
      }
      const frame = getSelectionFrame(doc, layout, id);
      if (frame)
        drawFrameOutline(res, canvas, frame, toScreenMatrix(camera, frame.matrix), camera.zoom);
    }

    const [only] = selection;
    const single =
      selection.length === 1 && only && !isConnector(doc, only)
        ? getSelectionFrame(doc, layout, only)
        : null;
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
    fillRect(res, canvas, screen, MARQUEE_FILL);
    strokeRect(res, canvas, screen, SELECTION, 1);
  }
};
