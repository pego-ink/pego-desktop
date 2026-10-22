import type { Box, Layout, PegoDocument, PegoNode, PegoNodeType } from "@pego/doc";

export const pointInBox = (box: Box, x: number, y: number): boolean =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

export const boxesIntersect = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

const hitNodes = (
  nodes: readonly PegoNode[],
  layout: Layout,
  x: number,
  y: number,
  trail: string[],
): string[] | null => {
  // Later siblings paint on top, so test them first.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) continue;
    const box = layout.get(node.id);
    if (!box) continue;
    const inside = pointInBox(box, x, y);

    if (node.type === "group") {
      // A group has no paint of its own: only its children are hit targets.
      const found = hitNodes(node.children, layout, x, y, [...trail, node.id]);
      if (found) return found;
      continue;
    }
    if (node.type === "frame") {
      if (node.clip && !inside) continue;
      const found = hitNodes(node.children, layout, x, y, [...trail, node.id]);
      if (found) return found;
    }
    // Refs are leaves here: any hit inside an instance selects the instance root.
    if (inside) return [...trail, node.id];
  }
  return null;
};

/**
 * Ancestor chain `[topLevelId, ..., deepestId]` of the topmost rendered node under a document
 * point, or null. Rotation is ignored in v0. Frames with `clip` hide children outside their box.
 */
export const hitPath = (doc: PegoDocument, layout: Layout, x: number, y: number): string[] | null =>
  hitNodes(doc.children, layout, x, y, []);

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
