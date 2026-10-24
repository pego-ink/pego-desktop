import {
  CONNECTOR_DEFAULT_STROKE,
  CONNECTOR_LABEL,
  connectorGeometryIn,
  distanceToPolyline,
  type Box,
  type ConnectorNode,
  flipOf,
  type Layout,
  pageOrFirst,
  type PegoDocument,
  type PegoNode,
  type PegoNodeType,
  resolveInstance,
  resolveNumber,
  resolveStrokeWidth,
} from "@pego/doc";

export const pointInBox = (box: Box, x: number, y: number): boolean =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

export const boxesIntersect = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

export type Point = { x: number; y: number };

const ORIGIN: Box = { x: 0, y: 0, width: 0, height: 0 };

/** Rotation (degrees, counter-clockwise) the renderer applies to a node. Refs use their resolved instance root. */
export const rotationOf = (doc: PegoDocument, node: PegoNode): number => {
  const resolved = node.type === "ref" ? resolveInstance(doc, node) : node;
  return resolveNumber(resolved?.rotation, doc.variables, 0);
};

/**
 * Map a point from the parent's local space (origin at the parent's top-left, already rotated by
 * the parent chain) into the node's local space: undo the translate, then undo `rotate(-rotation)`.
 */
const toLocal = (p: Point, box: Box, parent: Box, rotation: number): Point => {
  const dx = p.x - (box.x - parent.x);
  const dy = p.y - (box.y - parent.y);
  if (rotation === 0) return { x: dx, y: dy };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
};

/**
 * Map a point through the node's own mirror (flipX/flipY around its box center) so children, which
 * are drawn inside the mirrored space, are picked at the position they appear.
 */
const throughFlip = (p: Point, box: Box, node: PegoNode): Point => {
  const flip = flipOf(node);
  return { x: flip.x ? box.width - p.x : p.x, y: flip.y ? box.height - p.y : p.y };
};

/** Click tolerance around thin shapes, in screen pixels (callers divide by zoom). */
export const HIT_TOLERANCE_PX = 4;

const inLocalBox = (box: Box, p: Point, slack = 0): boolean =>
  p.x >= -slack && p.x <= box.width + slack && p.y >= -slack && p.y <= box.height + slack;

/**
 * Extra reach around a node's box in document units. Lines and thin paths have zero-size boxes,
 * so paths get the tolerance plus half their stroke width; other nodes keep their exact box.
 */
const slackOf = (doc: PegoDocument, node: PegoNode, tolerance: number): number => {
  if (tolerance <= 0 || node.type !== "path") return 0;
  const stroke = node.stroke ? resolveStrokeWidth(node.stroke.width, doc.variables) : 0;
  return tolerance + Math.max(0, stroke) / 2;
};

/** Rough label pill size (no font metrics here): enough to click the label. */
const labelReach = (node: ConnectorNode) => {
  const label = node.label?.trim() ?? "";
  if (!label) return null;
  const width = label.length * CONNECTOR_LABEL.fontSize * 0.6 + CONNECTOR_LABEL.padX * 2;
  const height = CONNECTOR_LABEL.fontSize * 1.4 + CONNECTOR_LABEL.padY * 2;
  return { halfWidth: width / 2, halfHeight: height / 2 };
};

/** A connector is hit near its line or on its label, not anywhere in its (often large) box. */
const hitsConnector = (
  doc: PegoDocument,
  layout: Layout,
  node: ConnectorNode,
  p: Point,
  tolerance: number,
): boolean => {
  const geometry = connectorGeometryIn(layout, node);
  if (!geometry) return false;
  const width = resolveStrokeWidth((node.stroke ?? CONNECTOR_DEFAULT_STROKE).width, doc.variables);
  if (distanceToPolyline(p, geometry.points) <= Math.max(tolerance, 2) + width / 2) return true;
  const reach = labelReach(node);
  return (
    reach !== null &&
    Math.abs(p.x - geometry.mid.x) <= reach.halfWidth &&
    Math.abs(p.y - geometry.mid.y) <= reach.halfHeight
  );
};

const hitNodes = (
  doc: PegoDocument,
  nodes: readonly PegoNode[],
  layout: Layout,
  p: Point,
  parent: Box,
  trail: string[],
  tolerance: number,
  skip?: ReadonlySet<string>,
): string[] | null => {
  // Later siblings paint on top, so test them first.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node || skip?.has(node.id)) continue;
    const box = layout.get(node.id);
    if (!box) continue;
    const local = toLocal(p, box, parent, rotationOf(doc, node));
    if (node.type === "connector") {
      // Its geometry is in document coordinates (connectors sit on the page, unrotated).
      const at = { x: local.x + box.x, y: local.y + box.y };
      if (hitsConnector(doc, layout, node, at, tolerance)) return [...trail, node.id];
      continue;
    }
    const inside = inLocalBox(box, local, slackOf(doc, node, tolerance));

    if (node.type === "group") {
      // A group has no paint of its own: only its children are hit targets.
      const found = hitNodes(
        doc,
        node.children,
        layout,
        throughFlip(local, box, node),
        box,
        [...trail, node.id],
        tolerance,
        skip,
      );
      if (found) return found;
      continue;
    }
    if (node.type === "frame") {
      if (node.clip && !inside) continue;
      const found = hitNodes(
        doc,
        node.children,
        layout,
        throughFlip(local, box, node),
        box,
        [...trail, node.id],
        tolerance,
        skip,
      );
      if (found) return found;
    }
    // Refs are leaves here: any hit inside an instance selects the instance root.
    if (inside) return [...trail, node.id];
  }
  return null;
};

export type HitOptions = {
  /** Document units that widen path hits so thin lines stay clickable at any zoom. */
  tolerance?: number;
  /** Ids invisible to the hit test, with their subtrees (e.g. the nodes being dragged). */
  skip?: ReadonlySet<string>;
  /** Page to hit-test (null = the first page); other pages are not on the canvas. */
  pageId?: string | null;
};

/**
 * Ancestor chain `[topLevelId, ..., deepestId]` of the topmost rendered node under a document
 * point, or null. Mirrors the renderer: each node is translated to its box relative to its parent
 * and rotated by `-rotation` degrees around its top-left, so the point is mapped into every node's
 * local space. Frames with `clip` hide children outside their (rotated) box. Only the nodes of
 * one page are on the canvas (see HitOptions).
 */
export const hitPath = (
  doc: PegoDocument,
  layout: Layout,
  x: number,
  y: number,
  options: HitOptions = {},
): string[] | null =>
  hitNodes(
    doc,
    pageOrFirst(doc, options.pageId).children,
    layout,
    { x, y },
    ORIGIN,
    [],
    options.tolerance ?? 0,
    options.skip,
  );

export type NodeIndexEntry = { parentId: string | null; type: PegoNodeType };
export type NodeIndex = Map<string, NodeIndexEntry>;

const indexCache = new WeakMap<PegoDocument, NodeIndex>();

/**
 * id -> parent/type for every real (non-expanded) node on every page. Memoized per document
 * snapshot. A page's top-level nodes have parent null, like a single-page canvas: pages
 * themselves are not part of the index.
 */
export const getNodeIndex = (doc: PegoDocument): NodeIndex => {
  const cached = indexCache.get(doc);
  if (cached) return cached;
  const index: NodeIndex = new Map();
  const walk = (nodes: readonly PegoNode[], parentId: string | null) => {
    for (const node of nodes) {
      index.set(node.id, { parentId, type: node.type });
      if (node.type === "frame" || node.type === "group") walk(node.children, node.id);
    }
  };
  for (const page of doc.children) walk(page.children, null);
  indexCache.set(doc, index);
  return index;
};
