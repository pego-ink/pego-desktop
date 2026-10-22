import type { Canvas as SkCanvas, CanvasKit, Paint, Path } from "canvaskit-wasm";
import type { PathNode } from "@pego/doc";

type Vec = { x: number; y: number };

export type PathMarker = NonNullable<PathNode["endMarker"]>;

/** Stroke details a `path` node adds on top of the plain stroke. */
export type PathExtras = Pick<PathNode, "strokeCap" | "strokeJoin" | "startMarker" | "endMarker">;

export type MarkerShape =
  | { kind: "polyline"; points: Vec[] }
  | { kind: "polygon"; points: Vec[] }
  | { kind: "circle"; cx: number; cy: number; r: number };

const MIN_MARKER_SIZE = 10;
const MARKER_SIZE_FACTOR = 5;
const ARROW_HALF_ANGLE = (30 * Math.PI) / 180;
const TRIANGLE_HALF_ANGLE = (25 * Math.PI) / 180;

/** Marker length for a stroke width. */
export const markerSize = (strokeWidth: number): number =>
  Math.max(MIN_MARKER_SIZE, strokeWidth * MARKER_SIZE_FACTOR);

const rotate = (v: Vec, angle: number): Vec => ({
  x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
  y: v.x * Math.sin(angle) + v.y * Math.cos(angle),
});

/**
 * Geometry of a marker whose tip sits at `tip`, pointing along `outward` (unit vector leaving the
 * path: the end tangent at the end, the reversed start tangent at the start). Null for "none".
 */
export const markerShape = (
  marker: PathMarker,
  tip: Vec,
  outward: Vec,
  strokeWidth: number,
): MarkerShape | null => {
  const size = markerSize(strokeWidth);
  const back = { x: -outward.x, y: -outward.y };
  const at = (v: Vec, length: number): Vec => ({
    x: tip.x + v.x * length,
    y: tip.y + v.y * length,
  });
  switch (marker) {
    case "none":
      return null;
    case "arrow":
      return {
        kind: "polyline",
        points: [
          at(rotate(back, ARROW_HALF_ANGLE), size),
          tip,
          at(rotate(back, -ARROW_HALF_ANGLE), size),
        ],
      };
    case "triangle": {
      const arm = size / Math.cos(TRIANGLE_HALF_ANGLE);
      return {
        kind: "polygon",
        points: [
          tip,
          at(rotate(back, TRIANGLE_HALF_ANGLE), arm),
          at(rotate(back, -TRIANGLE_HALF_ANGLE), arm),
        ],
      };
    }
    case "circle":
      return { kind: "circle", cx: tip.x, cy: tip.y, r: size * 0.4 };
    case "bar": {
      const normal = { x: -outward.y, y: outward.x };
      return { kind: "polyline", points: [at(normal, size / 2), at(normal, -size / 2)] };
    }
  }
};

type PathEnd = { pos: Vec; outward: Vec };
type PathEnds = { start: PathEnd | null; end: PathEnd | null };

const endsByPath = new WeakMap<Path, PathEnds>();

const unit = (x: number, y: number): Vec | null => {
  const length = Math.hypot(x, y);
  return length === 0 ? null : { x: x / length, y: y / length };
};

/** Position and outward direction at both ends of the first / last open contour. */
export const getPathEnds = (ck: CanvasKit, path: Path): PathEnds => {
  const cached = endsByPath.get(path);
  if (cached) return cached;
  const iter = new ck.ContourMeasureIter(path, false, 1);
  let first: PathEnd | null = null;
  let last: PathEnd | null = null;
  let isFirst = true;
  for (let contour = iter.next(); contour; contour = iter.next()) {
    const length = contour.length();
    const closed = contour.isClosed();
    if (!closed && length > 0) {
      const [sx = 0, sy = 0, svx = 0, svy = 0] = contour.getPosTan(0);
      const [ex = 0, ey = 0, evx = 0, evy = 0] = contour.getPosTan(length);
      const startDir = unit(-svx, -svy);
      const endDir = unit(evx, evy);
      if (isFirst && startDir) first = { pos: { x: sx, y: sy }, outward: startDir };
      last = endDir ? { pos: { x: ex, y: ey }, outward: endDir } : null;
    } else {
      last = null;
    }
    isFirst = false;
    contour.delete();
  }
  iter.delete();
  const ends = { start: first, end: last };
  endsByPath.set(path, ends);
  return ends;
};

/** Set cap and join on the shared stroke paint (defaults: butt / miter, like Skia). */
export const applyStrokeStyle = (ck: CanvasKit, paint: Paint, extras: PathExtras): void => {
  paint.setStrokeCap(
    extras.strokeCap === "round"
      ? ck.StrokeCap.Round
      : extras.strokeCap === "square"
        ? ck.StrokeCap.Square
        : ck.StrokeCap.Butt,
  );
  paint.setStrokeJoin(
    extras.strokeJoin === "round"
      ? ck.StrokeJoin.Round
      : extras.strokeJoin === "bevel"
        ? ck.StrokeJoin.Bevel
        : ck.StrokeJoin.Miter,
  );
};

const drawMarker = (
  ck: CanvasKit,
  canvas: SkCanvas,
  paint: Paint,
  shape: MarkerShape,
  strokeWidth: number,
) => {
  if (shape.kind === "circle") {
    paint.setStyle(ck.PaintStyle.Fill);
    canvas.drawCircle(shape.cx, shape.cy, shape.r, paint);
    return;
  }
  const marker = new ck.PathBuilder()
    .addPolygon(
      shape.points.flatMap((p) => [p.x, p.y]),
      shape.kind === "polygon",
    )
    .detachAndDelete();
  paint.setStyle(shape.kind === "polygon" ? ck.PaintStyle.Fill : ck.PaintStyle.Stroke);
  paint.setStrokeWidth(strokeWidth);
  canvas.drawPath(marker, paint);
  marker.delete();
};

/**
 * Stroke `path` with cap/join from `extras`, then draw its start/end markers in the paint's
 * color. The paint (shared stroke paint, already colored and sized) is restored afterwards.
 */
export const strokePathWithExtras = (
  ck: CanvasKit,
  canvas: SkCanvas,
  path: Path,
  paint: Paint,
  extras: PathExtras,
  strokeWidth: number,
): void => {
  applyStrokeStyle(ck, paint, extras);
  canvas.drawPath(path, paint);

  const wantsMarkers =
    (extras.startMarker && extras.startMarker !== "none") ||
    (extras.endMarker && extras.endMarker !== "none");
  if (wantsMarkers) {
    const ends = getPathEnds(ck, path);
    // Markers are always crisp: round cap/join regardless of the line's own.
    paint.setStrokeCap(ck.StrokeCap.Round);
    paint.setStrokeJoin(ck.StrokeJoin.Round);
    const pairs = [
      [extras.startMarker, ends.start],
      [extras.endMarker, ends.end],
    ] as const;
    for (const [marker, end] of pairs) {
      if (!marker || !end) continue;
      const shape = markerShape(marker, end.pos, end.outward, strokeWidth);
      if (shape) drawMarker(ck, canvas, paint, shape, strokeWidth);
    }
    paint.setStyle(ck.PaintStyle.Stroke);
  }
  applyStrokeStyle(ck, paint, {});
};
