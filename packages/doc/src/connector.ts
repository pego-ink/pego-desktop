import type { Box, Layout } from "./layout";
import type {
  ConnectorNode,
  ConnectorRoute,
  ConnectorSide,
  PegoDocument,
  PegoNode,
} from "./schema";
import type { Point } from "./paint";
import { collectIds, findNode } from "./tree";

/**
 * Connector geometry: the line between two layers' boxes, in document coordinates. Pure, shared
 * by the layout (a connector's box), the canvas, hit-testing and the exports.
 */

type Side = Exclude<ConnectorSide, "auto">;

export type ConnectorGeometry = {
  /** The line as a polyline (curves sampled), for hit-testing and the label. */
  points: Point[];
  /** SVG path data (rounded elbows, cubic curves). */
  d: string;
  /** Bounds of the line. */
  bounds: Box;
  /** Halfway along the line: where the label sits. */
  mid: Point;
};

/** Default look: a 2px slate line ending in an arrow. */
export const CONNECTOR_DEFAULT_STROKE = { color: "#64748B", width: 2 } as const;
/** The label: 12px text on a white pill outlined in the line's color. */
export const CONNECTOR_LABEL = {
  fontSize: 12,
  fontWeight: 500,
  color: "#0F172A",
  background: "#FFFFFF",
  padX: 8,
  padY: 4,
} as const;
/** How far an elbow leaves a box before it turns. */
const STUB = 24;
/** Radius of an elbow's rounded corners. */
const CORNER = 8;
const CURVE_SAMPLES = 24;

const NORMALS: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** The middle of a box's side. */
export const anchorOf = (box: Box, side: Side): Point => {
  const c = center(box);
  if (side === "top") return { x: c.x, y: box.y };
  if (side === "bottom") return { x: c.x, y: box.y + box.height };
  if (side === "left") return { x: box.x, y: c.y };
  return { x: box.x + box.width, y: c.y };
};

/**
 * The side of `box` that faces `other`: left/right when the boxes sit more side by side than
 * stacked (the larger gap wins), top/bottom otherwise.
 */
export const facingSide = (box: Box, other: Box): Side => {
  const gapX = Math.max(other.x - (box.x + box.width), box.x - (other.x + other.width));
  const gapY = Math.max(other.y - (box.y + box.height), box.y - (other.y + other.height));
  const a = center(box);
  const b = center(other);
  if (gapX >= gapY) return b.x >= a.x ? "right" : "left";
  return b.y >= a.y ? "bottom" : "top";
};

const resolveSide = (side: ConnectorSide | undefined, box: Box, other: Box): Side =>
  side === undefined || side === "auto" ? facingSide(box, other) : side;

const add = (p: Point, n: Point, length: number): Point => ({
  x: p.x + n.x * length,
  y: p.y + n.y * length,
});

const horizontal = (n: Point) => n.y === 0;

/** Drop repeated points and middle points of straight runs. */
const simplify = (points: Point[]): Point[] => {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = out[out.length - 2];
    if (before && last) {
      const cross = (last.x - before.x) * (p.y - last.y) - (last.y - before.y) * (p.x - last.x);
      if (Math.abs(cross) < 0.01) out.pop();
    }
    out.push(p);
  }
  return out;
};

/** Right-angle route from anchor `a` (leaving along `na`) to anchor `b` (entering against `nb`). */
const elbowPoints = (a: Point, na: Point, b: Point, nb: Point, boxA: Box, boxB: Box): Point[] => {
  const sa = add(a, na, STUB);
  const sb = add(b, nb, STUB);
  if (horizontal(na) && horizontal(nb)) {
    const forward = na.x * (b.x - a.x) > 0 && nb.x * (a.x - b.x) > 0;
    if (forward) {
      const mx = (a.x + b.x) / 2;
      return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
    }
    // Going back (or out of the same side): around, below both boxes when they are level.
    const my =
      Math.abs(a.y - b.y) > STUB * 2
        ? (a.y + b.y) / 2
        : Math.max(boxA.y + boxA.height, boxB.y + boxB.height) + STUB;
    return [a, sa, { x: sa.x, y: my }, { x: sb.x, y: my }, sb, b];
  }
  if (!horizontal(na) && !horizontal(nb)) {
    const forward = na.y * (b.y - a.y) > 0 && nb.y * (a.y - b.y) > 0;
    if (forward) {
      const my = (a.y + b.y) / 2;
      return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
    }
    const mx =
      Math.abs(a.x - b.x) > STUB * 2
        ? (a.x + b.x) / 2
        : Math.max(boxA.x + boxA.width, boxB.x + boxB.width) + STUB;
    return [a, sa, { x: mx, y: sa.y }, { x: mx, y: sb.y }, sb, b];
  }
  if (horizontal(na)) {
    // Out sideways, in from the top or bottom: one corner when both legs go forward.
    if (na.x * (b.x - a.x) > 0 && nb.y * (a.y - b.y) > 0) return [a, { x: b.x, y: a.y }, b];
    return [a, sa, { x: sa.x, y: sb.y }, sb, b];
  }
  if (na.y * (b.y - a.y) > 0 && nb.x * (a.x - b.x) > 0) return [a, { x: a.x, y: b.y }, b];
  return [a, sa, { x: sb.x, y: sa.y }, sb, b];
};

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const pt = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`;

/** SVG path through `points` with the corners rounded (radius at most half of each leg). */
const roundedPath = (points: Point[]): string => {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M ${pt(first)}`;
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i]!;
    const prev = points[i]!;
    const next = rest[i + 1];
    if (!next) {
      d += ` L ${pt(p)}`;
      break;
    }
    const inLength = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLength = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(CORNER, inLength / 2, outLength / 2);
    const before = add(p, { x: (prev.x - p.x) / inLength, y: (prev.y - p.y) / inLength }, r);
    const after = add(p, { x: (next.x - p.x) / outLength, y: (next.y - p.y) / outLength }, r);
    d += ` L ${pt(before)} Q ${pt(p)} ${pt(after)}`;
  }
  return d;
};

const cubicAt = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
  };
};

const boundsOf = (points: Point[]): Box => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/** The point halfway along a polyline. */
export const midpointOf = (points: readonly Point[]): Point => {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let left = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (left <= length && length > 0) {
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + ((b.x - a.x) * left) / length, y: a.y + ((b.y - a.y) * left) / length };
    }
    left -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
};

/** The line from box `from` to box `to`. */
export const connectorGeometry = (
  from: Box,
  to: Box,
  options: { fromSide?: ConnectorSide; toSide?: ConnectorSide; route?: ConnectorRoute } = {},
): ConnectorGeometry => {
  const sideA = resolveSide(options.fromSide, from, to);
  const sideB = resolveSide(options.toSide, to, from);
  const a = anchorOf(from, sideA);
  const b = anchorOf(to, sideB);
  const na = NORMALS[sideA];
  const nb = NORMALS[sideB];
  const route = options.route ?? "elbow";

  if (route === "straight") {
    const points = [a, b];
    return {
      points,
      d: `M ${pt(a)} L ${pt(b)}`,
      bounds: boundsOf(points),
      mid: midpointOf(points),
    };
  }
  if (route === "curved") {
    const pull = Math.max(30, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
    const c1 = add(a, na, pull);
    const c2 = add(b, nb, pull);
    const points = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) =>
      cubicAt(a, c1, c2, b, i / CURVE_SAMPLES),
    );
    return {
      points,
      d: `M ${pt(a)} C ${pt(c1)} ${pt(c2)} ${pt(b)}`,
      bounds: boundsOf(points),
      mid: midpointOf(points),
    };
  }
  const points = simplify(elbowPoints(a, na, b, nb, from, to));
  return { points, d: roundedPath(points), bounds: boundsOf(points), mid: midpointOf(points) };
};

/** A connector's line from the current layout, or null while one of its ends has no box. */
export const connectorGeometryIn = (
  layout: Layout,
  node: ConnectorNode,
): ConnectorGeometry | null => {
  const from = layout.get(node.from.id);
  const to = layout.get(node.to.id);
  if (!from || !to || node.from.id === node.to.id) return null;
  return connectorGeometry(from, to, {
    fromSide: node.from.side,
    toSide: node.to.side,
    route: node.route,
  });
};

/** Distance from `p` to the polyline. */
export const distanceToPolyline = (p: Point, points: readonly Point[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
};

/** Ids of the connectors anywhere in `nodes` that are attached to one of `ids`. */
export const connectorsAttachedTo = (
  nodes: readonly PegoNode[],
  ids: ReadonlySet<string>,
  into: string[] = [],
): string[] => {
  for (const node of nodes) {
    if (node.type === "connector" && (ids.has(node.from.id) || ids.has(node.to.id))) {
      into.push(node.id);
    }
    if ("children" in node) connectorsAttachedTo(node.children, ids, into);
  }
  return into;
};

/**
 * The connectors that deleting `ids` (with their subtrees) would leave without an end: delete
 * them in the same step. Connectors in `ids` themselves are not listed.
 */
export const danglingConnectors = (doc: PegoDocument, ids: readonly string[]): string[] => {
  const gone = new Set<string>();
  for (const id of ids) {
    const node = findNode(doc, id);
    if (node) collectIds(node, gone);
  }
  return connectorsAttachedTo(doc.children, gone).filter((id) => !gone.has(id));
};
