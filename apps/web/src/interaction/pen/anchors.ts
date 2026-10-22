/** Pure anchor/handle math for the pen tool. Handles are stored as absolute positions. */

export type Pt = { x: number; y: number };

export type Anchor = {
  p: Pt;
  /** Incoming handle (controls the segment that ends at this anchor). */
  in: Pt | null;
  /** Outgoing handle (controls the segment that starts at this anchor). */
  out: Pt | null;
};

export type Contour = { anchors: Anchor[]; closed: boolean };

const EPS = 1e-6;

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => pt(a.x + b.x, a.y + b.y);
export const sub = (a: Pt, b: Pt): Pt => pt(a.x - b.x, a.y - b.y);
export const scale = (a: Pt, k: number): Pt => pt(a.x * k, a.y * k);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt =>
  pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const samePt = (a: Pt, b: Pt, eps = EPS): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

export const cornerAnchor = (p: Pt): Anchor => ({ p, in: null, out: null });

/** Snap `target` so the vector from `origin` points at a multiple of 45 degrees (length kept). */
export const constrain45 = (origin: Pt, target: Pt): Pt => {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return target;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return pt(origin.x + Math.cos(angle) * length, origin.y + Math.sin(angle) * length);
};

/** The point opposite `handle` through `anchorPoint` (equal length). */
export const mirror = (anchorPoint: Pt, handle: Pt): Pt =>
  pt(2 * anchorPoint.x - handle.x, 2 * anchorPoint.y - handle.y);

/** True when both handles exist and point in opposite directions along one line. */
export const isSmooth = (a: Anchor): boolean => {
  if (!a.in || !a.out) return false;
  const i = sub(a.in, a.p);
  const o = sub(a.out, a.p);
  const li = Math.hypot(i.x, i.y);
  const lo = Math.hypot(o.x, o.y);
  if (li < EPS || lo < EPS) return false;
  const cross = (i.x * o.y - i.y * o.x) / (li * lo);
  const dot = (i.x * o.x + i.y * o.y) / (li * lo);
  return Math.abs(cross) < 1e-3 && dot < 0;
};

/**
 * Drag a handle. `breakSymmetry` (Alt) leaves the opposite handle alone. Otherwise a smooth anchor
 * keeps its collinearity (opposite handle keeps its length) and a fresh one-handle anchor mirrors
 * fully (the way a click-drag creates handles).
 */
export const dragHandle = (
  a: Anchor,
  which: "in" | "out",
  to: Pt,
  breakSymmetry: boolean,
): Anchor => {
  const other = which === "in" ? "out" : "in";
  const otherHandle = a[other];
  let next: Pt | null = otherHandle;
  if (!breakSymmetry) {
    if (!otherHandle) next = mirror(a.p, to);
    else if (isSmooth(a)) {
      const dir = sub(a.p, to);
      const len = Math.hypot(dir.x, dir.y);
      const keep = dist(otherHandle, a.p);
      next = len < EPS ? otherHandle : add(a.p, scale(dir, keep / len));
    }
  }
  return { ...a, [which]: to, [other]: next };
};

/** Click-drag while creating: out follows the pointer, in mirrors it unless Alt is held. */
export const creationDrag = (a: Anchor, to: Pt, breakSymmetry: boolean): Anchor => ({
  ...a,
  out: to,
  in: breakSymmetry ? a.in : mirror(a.p, to),
});

export const translateAnchor = (a: Anchor, dx: number, dy: number): Anchor => ({
  p: pt(a.p.x + dx, a.p.y + dy),
  in: a.in && pt(a.in.x + dx, a.in.y + dy),
  out: a.out && pt(a.out.x + dx, a.out.y + dy),
});

export const translateContours = (
  contours: readonly Contour[],
  dx: number,
  dy: number,
): Contour[] =>
  contours.map((c) => ({ ...c, anchors: c.anchors.map((a) => translateAnchor(a, dx, dy)) }));

const neighbours = (c: Contour, i: number): { prev: Anchor | null; next: Anchor | null } => {
  const n = c.anchors.length;
  const prev = i > 0 ? c.anchors[i - 1] : c.closed ? c.anchors[n - 1] : undefined;
  const next = i < n - 1 ? c.anchors[i + 1] : c.closed ? c.anchors[0] : undefined;
  return { prev: prev ?? null, next: next ?? null };
};

/** Alt-click: anchors with handles become corners; corners become smooth (tangent through neighbours). */
export const toggleSmooth = (c: Contour, i: number): Contour => {
  const a = c.anchors[i];
  if (!a) return c;
  const set = (anchor: Anchor): Contour => ({
    ...c,
    anchors: c.anchors.map((x, idx) => (idx === i ? anchor : x)),
  });
  if (a.in || a.out) return set({ p: a.p, in: null, out: null });
  const { prev, next } = neighbours(c, i);
  const from = prev?.p ?? a.p;
  const to = next?.p ?? a.p;
  const tangent = sub(to, from);
  const length = Math.hypot(tangent.x, tangent.y);
  if (length < EPS) return c;
  const unit = scale(tangent, 1 / length);
  return set({
    p: a.p,
    in: prev ? sub(a.p, scale(unit, dist(prev.p, a.p) / 3)) : null,
    out: next ? add(a.p, scale(unit, dist(next.p, a.p) / 3)) : null,
  });
};

/** Remove an anchor; a closed contour that drops below 3 anchors becomes open. */
export const removeAnchor = (c: Contour, i: number): Contour => {
  const anchors = c.anchors.filter((_, idx) => idx !== i);
  return { anchors, closed: c.closed && anchors.length >= 3 };
};

/** Can a click at `point` close the contour (it lands on the first anchor)? */
export const canClose = (c: Contour, point: Pt, tolerance: number): boolean => {
  const [first] = c.anchors;
  return !c.closed && c.anchors.length >= 2 && !!first && dist(first.p, point) <= tolerance;
};
