export type Point = { x: number; y: number };

export type CubicSegment = { c1: Point; c2: Point; to: Point };

const fmt = (v: number): string => `${Math.round(v * 100) / 100}`;

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Distance from `p` to the segment `a`-`b`. */
const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
};

/** Ramer-Douglas-Peucker: drop points closer than `tolerance` to the simplified polyline. */
export const simplifyRdp = (points: readonly Point[], tolerance: number): Point[] => {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 3) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  // Iterative to survive thousands of samples without blowing the call stack.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [from, to] = range;
    const a = points[from];
    const b = points[to];
    if (!a || !b) continue;
    let maxDistance = 0;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const p = points[i];
      if (!p) continue;
      const d = distanceToSegment(p, a, b);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (index === -1 || maxDistance <= tolerance) continue;
    keep[index] = true;
    stack.push([from, index], [index, to]);
  }
  return points.filter((_, i) => keep[i]);
};

/**
 * Catmull-Rom spline through `points`, converted to cubic Béziers (uniform, tension 0.5: the
 * control points are `p1 + (p2 - p0) / 6` and `p2 - (p3 - p1) / 6`; ends reuse the end point).
 */
export const smoothToCubics = (points: readonly Point[]): CubicSegment[] => {
  const segments: CubicSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (!p1 || !p2) continue;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    segments.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: p2,
    });
  }
  return segments;
};

/** SVG path data: `M start C ... C ...`, every point shifted by `-origin`. */
export const cubicsToPathData = (
  start: Point,
  segments: readonly CubicSegment[],
  origin: Point = { x: 0, y: 0 },
): string => {
  const pt = (p: Point) => `${fmt(p.x - origin.x)} ${fmt(p.y - origin.y)}`;
  return [`M${pt(start)}`, ...segments.map((s) => `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.to)}`)].join(
    " ",
  );
};

export const polylineToPathData = (points: readonly Point[], origin: Point): string =>
  points
    .map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x - origin.x)} ${fmt(p.y - origin.y)}`)
    .join(" ");

export const boundsOf = (points: readonly Point[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Move `end` onto the nearest multiple of 45 degrees around `start`, keeping its distance. */
export const snapAngle45 = (start: Point, end: Point): Point => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { ...end };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) };
};

export type FreehandPath = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Path data relative to (x, y). */
  geometry: string;
};

/**
 * Turn raw stroke samples (doc space) into a node-ready path: RDP simplify with `tolerance`, then
 * smooth to cubics. `straight` keeps only first and last point. Null when there is no stroke.
 */
export const buildFreehandPath = (
  samples: readonly Point[],
  tolerance: number,
  straight = false,
): FreehandPath | null => {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  const simplified = straight ? [first, last] : simplifyRdp(samples, tolerance);
  const bounds = boundsOf(simplified);
  if (bounds.width === 0 && bounds.height === 0) return null;
  const origin = { x: bounds.x, y: bounds.y };
  const [start] = simplified;
  if (!start) return null;
  const geometry =
    simplified.length === 2
      ? polylineToPathData(simplified, origin)
      : cubicsToPathData(start, smoothToCubics(simplified), origin);
  return { ...origin, width: bounds.width, height: bounds.height, geometry };
};

/** Straight path from `start` to `end`, normalized so the node box is the segment's bounding box. */
export const buildLinePath = (start: Point, end: Point): FreehandPath => {
  const bounds = boundsOf([start, end]);
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    geometry: polylineToPathData([start, end], { x: bounds.x, y: bounds.y }),
  };
};
