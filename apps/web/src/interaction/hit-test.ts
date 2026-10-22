import {
  resolveInstance,
  resolveNumber,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type PegoNodeType,
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

const inLocalBox = (box: Box, p: Point): boolean =>
  p.x >= 0 && p.x <= box.width && p.y >= 0 && p.y <= box.height;

const hitNodes = (
  doc: PegoDocument,
  nodes: readonly PegoNode[],
  layout: Layout,
  p: Point,
  parent: Box,
  trail: string[],
): string[] | null => {
  // Later siblings paint on top, so test them first.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) continue;
    const box = layout.get(node.id);
    if (!box) continue;
    const local = toLocal(p, box, parent, rotationOf(doc, node));
    const inside = inLocalBox(box, local);

    if (node.type === "group") {
      // A group has no paint of its own: only its children are hit targets.
      const found = hitNodes(doc, node.children, layout, local, box, [...trail, node.id]);
      if (found) return found;
      continue;
    }
    if (node.type === "frame") {
      if (node.clip && !inside) continue;
      const found = hitNodes(doc, node.children, layout, local, box, [...trail, node.id]);
      if (found) return found;
    }
    // Refs are leaves here: any hit inside an instance selects the instance root.
    if (inside) return [...trail, node.id];
  }
  return null;
};

/**
 * Ancestor chain `[topLevelId, ..., deepestId]` of the topmost rendered node under a document
 * point, or null. Mirrors the renderer: each node is translated to its box relative to its parent
 * and rotated by `-rotation` degrees around its top-left, so the point is mapped into every node's
 * local space. Frames with `clip` hide children outside their (rotated) box.
 */
export const hitPath = (doc: PegoDocument, layout: Layout, x: number, y: number): string[] | null =>
  hitNodes(doc, doc.children, layout, { x, y }, ORIGIN, []);

export type NodeIndexEntry = { parentId: string | null; type: PegoNodeType };
export type NodeIndex = Map<string, NodeIndexEntry>;

const indexCache = new WeakMap<PegoDocument, NodeIndex>();

/** id -> parent/type for every real (non-expanded) node. Memoized per document snapshot. */
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
  walk(doc.children, null);
  indexCache.set(doc, index);
  return index;
};
