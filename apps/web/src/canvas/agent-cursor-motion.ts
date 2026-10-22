/** Pure motion math for the canvas agent cursor (no DOM, no stores). */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Fraction = { fx: number; fy: number };

/** Log entries newer than this keep the cursor alive while the run status is idle (terminal runs). */
export const IDLE_ACTIVITY_MS = 4000;

const ACTIVE_STATUSES = new Set(["planning", "running", "awaiting_decision"]);

export const isCursorActive = (status: string, lastLogAt: number | null, now: number): boolean => {
  if (ACTIVE_STATUSES.has(status)) return true;
  return status === "idle" && lastLogAt !== null && now - lastLogAt < IDLE_ACTIVITY_MS;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Strong ease-out (quartic): fast departure, long soft landing. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 4);

/** Deterministic string hash (FNV-1a), 32-bit unsigned. */
export const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/** Deterministic pseudo-random number in [0, 1) from a seed and a stream index. */
export const seeded = (seed: number, index: number): number => {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Smallest rect containing all rects; null for an empty list. */
export const unionRect = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const pointInRect = (rect: Rect, { fx, fy }: Fraction): Point => ({
  x: rect.x + rect.width * fx,
  y: rect.y + rect.height * fy,
});

/** Natural first aim: upper-left quadrant inside the box, varied per target key. */
export const pickTargetAnchor = (key: string): Fraction => {
  const seed = hashString(key);
  return { fx: 0.12 + seeded(seed, 0) * 0.34, fy: 0.12 + seeded(seed, 1) * 0.3 };
};

const INSPECT_ANCHORS: readonly Fraction[] = [
  { fx: 1, fy: 1 },
  { fx: 1, fy: 0 },
  { fx: 0, fy: 1 },
  { fx: 0.5, fy: 1 },
  { fx: 1, fy: 0.5 },
  { fx: 0, fy: 0 },
  { fx: 0.5, fy: 0 },
  { fx: 0, fy: 0.5 },
];

/** Micro-move along the box edges, like inspecting or drag-resizing a handle. */
export const pickInspectAnchor = (key: string, step: number): Fraction => {
  const seed = hashString(key);
  const base = INSPECT_ANCHORS[Math.floor(seeded(seed, 10 + step) * INSPECT_ANCHORS.length)]!;
  const jitter = (n: number) => (seeded(seed, 40 + step * 2 + n) - 0.5) * 0.08;
  return { fx: clamp(base.fx + jitter(0), 0, 1), fy: clamp(base.fy + jitter(1), 0, 1) };
};

/** Gentle wander near the viewport center/top while nothing is targeted yet. */
export const pickWanderPoint = (size: { width: number; height: number }, step: number): Point => ({
  x: size.width * (0.5 + (seeded(7, step) - 0.5) * 0.36),
  y: size.height * (0.26 + seeded(11, step) * 0.16),
});

/** Parking spot near the agent panel side while a decision is pending. */
export const pickParkPoint = (size: { width: number; height: number }, step: number): Point => ({
  x: size.width - 72 - seeded(3, step) * 16,
  y: size.height * (0.38 + seeded(5, step) * 0.08),
});

/** Keep the cursor tip visible inside the viewport. */
export const clampToSize = (
  point: Point,
  size: { width: number; height: number },
  margin = 20,
): Point => ({
  x: clamp(point.x, margin, Math.max(margin, size.width - margin)),
  y: clamp(point.y, margin, Math.max(margin, size.height - margin)),
});

/** Glide duration: 400ms for short hops up to 700ms for cross-canvas travel. `scale` shortens micro-moves. */
export const glideDuration = (distancePx: number, scale = 1): number =>
  (400 + clamp(distancePx, 0, 1200) * 0.25) * scale;

export type Glide = {
  from: Point;
  start: number;
  duration: number;
  /** Signed bend of the path as a fraction of its length (perpendicular offset of the control point). */
  bend: number;
};

export const createGlide = (
  from: Point,
  to: Point,
  start: number,
  zoom: number,
  seed: number,
  scale = 1,
): Glide => {
  const distance = Math.hypot(to.x - from.x, to.y - from.y) * zoom;
  const sign = seeded(seed, 99) < 0.5 ? -1 : 1;
  return {
    from,
    start,
    duration: glideDuration(distance, scale),
    bend: sign * (0.1 + seeded(seed, 98) * 0.1),
  };
};

/** Point on a quadratic curve from `from` to `to` bent sideways by `bend`. */
export const curvePoint = (from: Point, to: Point, t: number, bend: number): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = { x: (from.x + to.x) / 2 - dy * bend, y: (from.y + to.y) / 2 + dx * bend };
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
};

/** Position along a glide at `now`. `to` is passed per frame so moving targets stay tracked. */
export const glideAt = (glide: Glide, to: Point, now: number): { point: Point; done: boolean } => {
  const t = clamp((now - glide.start) / glide.duration, 0, 1);
  if (t >= 1) return { point: to, done: true };
  return { point: curvePoint(glide.from, to, easeOut(t), glide.bend), done: false };
};

/** Tiny always-on wander in screen pixels (sum of slow sines) so the cursor never freezes. */
export const driftOffset = (timeMs: number, seed: number, amplitude = 2.4): Point => {
  const t = timeMs / 1000;
  const p1 = seeded(seed, 1) * Math.PI * 2;
  const p2 = seeded(seed, 2) * Math.PI * 2;
  return {
    x: amplitude * (Math.sin(t * 0.9 + p1) * 0.7 + Math.sin(t * 2.3 + p2) * 0.3),
    y: amplitude * (Math.cos(t * 0.7 + p2) * 0.7 + Math.sin(t * 1.9 + p1) * 0.3),
  };
};

/** Delay until the next micro-move, 1.8s to 3.4s. */
export const nextInspectDelay = (key: string, step: number): number =>
  1800 + seeded(hashString(key), 70 + step) * 1600;
