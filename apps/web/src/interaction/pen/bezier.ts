import { dist, lerp, pt, type Anchor, type Contour, type Pt } from "./anchors";

/** One cubic piece of a contour (straight segments have control points on their ends). */
export type Segment = {
  /** Index of the start anchor; the end anchor is `(index + 1) % anchors.length`. */
  index: number;
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
};

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export const segmentsOf = (c: Contour): Segment[] => {
  const n = c.anchors.length;
  const count = c.closed ? n : n - 1;
  const out: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const a = c.anchors[i] as Anchor;
    const b = c.anchors[(i + 1) % n] as Anchor;
    out.push({ index: i, p0: a.p, c1: a.out ?? a.p, c2: b.in ?? b.p, p3: b.p });
  }
  return out;
};

export const evalSegment = (s: Segment, t: number): Pt => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return pt(
    w0 * s.p0.x + w1 * s.c1.x + w2 * s.c2.x + w3 * s.p3.x,
    w0 * s.p0.y + w1 * s.c1.y + w2 * s.c2.y + w3 * s.p3.y,
  );
};

/** Parameters in (0,1) where one axis of the cubic has a local extremum. */
const extrema = (p0: number, c1: number, c2: number, p3: number): number[] => {
  const a = -p0 + 3 * c1 - 3 * c2 + p3;
  const b = 2 * (p0 - 2 * c1 + c2);
  const c = c1 - p0;
  const inRange = (t: number) => t > 0 && t < 1;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter(inRange);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter(inRange);
};

/** Tight bounding box of every contour (curve extrema included), or null when empty. */
export const boundsOfContours = (contours: readonly Contour[]): Rect | null => {
  let rect: Rect | null = null;
  const grow = (p: Pt) => {
    rect = rect
      ? {
          minX: Math.min(rect.minX, p.x),
          minY: Math.min(rect.minY, p.y),
          maxX: Math.max(rect.maxX, p.x),
          maxY: Math.max(rect.maxY, p.y),
        }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  };
  for (const c of contours) {
    for (const a of c.anchors) grow(a.p);
    for (const s of segmentsOf(c)) {
      const ts = [
        ...extrema(s.p0.x, s.c1.x, s.c2.x, s.p3.x),
        ...extrema(s.p0.y, s.c1.y, s.c2.y, s.p3.y),
      ];
      for (const t of ts) grow(evalSegment(s, t));
    }
  }
  return rect;
};

const SAMPLES = 32;

export type SegmentHit = { index: number; t: number; point: Pt; distance: number };

/** Closest point on one segment to `target`: coarse sampling, then golden-section refinement. */
export const nearestOnSegment = (s: Segment, target: Pt): SegmentHit => {
  let bestT = 0;
  let best = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const d = dist(evalSegment(s, t), target);
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - 1 / SAMPLES);
  let hi = Math.min(1, bestT + 1 / SAMPLES);
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 24; i++) {
    const m1 = hi - (hi - lo) * phi;
    const m2 = lo + (hi - lo) * phi;
    if (dist(evalSegment(s, m1), target) < dist(evalSegment(s, m2), target)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const point = evalSegment(s, t);
  return { index: s.index, t, point, distance: dist(point, target) };
};

export type ContourHit = SegmentHit & { contour: number };

/** Nearest segment (over all contours) within `tolerance` of `target`, or null. */
export const hitTestSegments = (
  contours: readonly Contour[],
  target: Pt,
  tolerance: number,
): ContourHit | null => {
  let best: ContourHit | null = null;
  contours.forEach((c, contour) => {
    for (const s of segmentsOf(c)) {
      const hit = nearestOnSegment(s, target);
      if (hit.distance <= tolerance && (!best || hit.distance < best.distance)) {
        best = { ...hit, contour };
      }
    }
  });
  return best;
};

/**
 * Insert an anchor at parameter `t` of the segment starting at anchor `index`, splitting the
 * curve (de Casteljau) so the shape is unchanged. Returns the new contour and the new anchor's index.
 */
export const insertAnchorAt = (
  c: Contour,
  index: number,
  t: number,
): { contour: Contour; index: number } => {
  const n = c.anchors.length;
  const a = c.anchors[index] as Anchor;
  const bIndex = (index + 1) % n;
  const b = c.anchors[bIndex] as Anchor;
  const straight = !a.out && !b.in;
  const s: Segment = { index, p0: a.p, c1: a.out ?? a.p, c2: b.in ?? b.p, p3: b.p };
  const q0 = lerp(s.p0, s.c1, t);
  const q1 = lerp(s.c1, s.c2, t);
  const q2 = lerp(s.c2, s.p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const mid = lerp(r0, r1, t);
  const inserted: Anchor = straight
    ? { p: lerp(s.p0, s.p3, t), in: null, out: null }
    : { p: mid, in: r0, out: r1 };
  const anchors = c.anchors.map((x, i) => {
    if (straight) return x;
    if (i === index) return { ...x, out: q0 };
    if (i === bIndex) return { ...x, in: q2 };
    return x;
  });
  const at = index + 1;
  // The closing segment of a closed contour appends after the last anchor.
  anchors.splice(at, 0, inserted);
  return { contour: { ...c, anchors }, index: at };
};
