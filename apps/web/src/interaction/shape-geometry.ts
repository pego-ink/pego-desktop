export type Point = { x: number; y: number };

/** Default star proportions (Figma): 5 points, inner radius at 38% of the outer radius. */
export const STAR_POINTS = 5;
export const STAR_INNER_RATIO = 0.38;
export const POLYGON_SIDES = 3;

const TWO_PI = Math.PI * 2;

/** Vertices on the unit circle, first one straight up, clockwise (y grows downwards). */
const unitCircle = (count: number, radius: (index: number) => number): Point[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * TWO_PI) / count;
    const r = radius(i);
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });

/** Regular polygon with `sides` corners on the unit circle. */
export const polygonVertices = (sides: number): Point[] => {
  const count = Math.max(3, Math.floor(sides));
  return unitCircle(count, () => 1);
};

/** Star with `points` tips on the unit circle; inner vertices sit at `innerRatio`. */
export const starVertices = (points: number, innerRatio: number): Point[] => {
  const tips = Math.max(3, Math.floor(points));
  const ratio = Math.min(Math.max(innerRatio, 0.01), 0.99);
  return unitCircle(tips * 2, (i) => (i % 2 === 0 ? 1 : ratio));
};

/** Scale and move `points` so their bounding box exactly fills `0,0 .. width,height`. */
export const fitToBox = (points: readonly Point[], width: number, height: number): Point[] => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  return points.map((p) => ({
    x: ((p.x - minX) / spanX) * width,
    y: ((p.y - minY) / spanY) * height,
  }));
};

const num = (v: number): string => String(Math.round(v * 100) / 100);

/** Closed SVG path through `points`. */
export const toPathData = (points: readonly Point[]): string =>
  `${points.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ")} Z`;

export type ShapeKind = "polygon" | "star";

/** Outline of the shape fitted to a `width` x `height` box. */
export const shapePoints = (kind: ShapeKind, width: number, height: number): Point[] =>
  fitToBox(
    kind === "polygon"
      ? polygonVertices(POLYGON_SIDES)
      : starVertices(STAR_POINTS, STAR_INNER_RATIO),
    width,
    height,
  );

export const shapePath = (kind: ShapeKind, width: number, height: number): string =>
  toPathData(shapePoints(kind, width, height));
