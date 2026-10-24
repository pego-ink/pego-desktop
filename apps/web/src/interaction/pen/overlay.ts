import type { Canvas as SkCanvas, CanvasKit, Paint, PathBuilder } from "canvaskit-wasm";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { SELECTION } from "@/canvas/chrome-colors";
import { docToScreen, type Camera } from "@/canvas/types";
import type { Anchor, Contour, Pt } from "./anchors";
import { segmentsOf } from "./bezier";

const ANCHOR_SIZE = 7;
const HANDLE_RADIUS = 3.5;

const withPaint = (ck: CanvasKit, setup: (p: Paint) => void, draw: (p: Paint) => void) => {
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  try {
    setup(paint);
    draw(paint);
  } finally {
    paint.delete();
  }
};

const strokePaint =
  (ck: CanvasKit, width: number, color = SELECTION) =>
  (p: Paint) => {
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setColor(ck.parseColorString(color));
  };

const fillPaint = (ck: CanvasKit, color: string) => (p: Paint) => {
  p.setStyle(ck.PaintStyle.Fill);
  p.setColor(ck.parseColorString(color));
};

/** Build a path with `build`, stroke it, and release the native objects. */
const strokeBuilt = (
  ck: CanvasKit,
  canvas: SkCanvas,
  width: number,
  build: (b: PathBuilder) => void,
) => {
  const builder = new ck.PathBuilder();
  build(builder);
  const path = builder.detachAndDelete();
  try {
    withPaint(ck, strokePaint(ck, width), (p) => canvas.drawPath(path, p));
  } finally {
    path.delete();
  }
};

const toScreen = (camera: Camera, p: Pt): Pt => docToScreen(camera, p.x, p.y);

/** Outline of contours (document coords) in screen space. */
export const drawContours = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  contours: readonly Contour[],
  camera: Camera,
  width = 1.5,
) => {
  const { ck } = res;
  strokeBuilt(ck, canvas, width, (path) => {
    for (const c of contours) {
      const [first] = c.anchors;
      if (!first) continue;
      const start = toScreen(camera, first.p);
      path.moveTo(start.x, start.y);
      for (const s of segmentsOf(c)) {
        const c1 = toScreen(camera, s.c1);
        const c2 = toScreen(camera, s.c2);
        const end = toScreen(camera, s.p3);
        path.cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
      }
      if (c.closed) path.close();
    }
  });
};

/** The preview segment from `from` to `to` (document coords), thinner than the committed path. */
export const drawRubberBand = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  from: Anchor,
  to: Pt,
  toIn: Pt | null,
  camera: Camera,
) => {
  const { ck } = res;
  const a = toScreen(camera, from.p);
  const c1 = toScreen(camera, from.out ?? from.p);
  const c2 = toScreen(camera, toIn ?? to);
  const b = toScreen(camera, to);
  strokeBuilt(ck, canvas, 1, (path) => {
    path.moveTo(a.x, a.y);
    path.cubicTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  });
};

/** White square with an accent border; `filled` (selected / last) fills it with the accent. */
export const drawAnchorMarker = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  at: Pt,
  camera: Camera,
  state: { filled?: boolean; hot?: boolean } = {},
) => {
  const { ck } = res;
  const s = toScreen(camera, at);
  const size = state.hot ? ANCHOR_SIZE + 3 : ANCHOR_SIZE;
  const rect = ck.XYWHRect(s.x - size / 2, s.y - size / 2, size, size);
  withPaint(ck, fillPaint(ck, state.filled ? SELECTION : "#FFFFFF"), (p) =>
    canvas.drawRect(rect, p),
  );
  withPaint(ck, strokePaint(ck, 1.5), (p) => canvas.drawRect(rect, p));
};

/** Handle line from the anchor plus a small round knob. */
export const drawHandle = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  anchor: Pt,
  handle: Pt,
  camera: Camera,
) => {
  const { ck } = res;
  const a = toScreen(camera, anchor);
  const h = toScreen(camera, handle);
  withPaint(ck, strokePaint(ck, 1), (p) => canvas.drawLine(a.x, a.y, h.x, h.y, p));
  withPaint(ck, fillPaint(ck, "#FFFFFF"), (p) => canvas.drawCircle(h.x, h.y, HANDLE_RADIUS, p));
  withPaint(ck, strokePaint(ck, 1.5), (p) => canvas.drawCircle(h.x, h.y, HANDLE_RADIUS, p));
};

export const drawAnchorHandles = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  a: Anchor,
  camera: Camera,
) => {
  if (a.in) drawHandle(res, canvas, a.p, a.in, camera);
  if (a.out) drawHandle(res, canvas, a.p, a.out, camera);
};
