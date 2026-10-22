import {
  MAX_INSTANCE_DEPTH,
  isContainer,
  resolveInstance,
  resolveNumber,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";

/** 2D affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * How a node is placed inside its parent's local space: translate to its box relative to the
 * parent's box, then rotate about its own top-left (positive `rotation` is counter-clockwise on
 * screen, hence the negated angle). The renderer and the hover outline both read this so they
 * cannot drift apart.
 */
export const nodePlacement = (box: Box, parent: Box, rotation: number) => ({
  x: box.x - parent.x,
  y: box.y - parent.y,
  /** Degrees as handed to `canvas.rotate` (clockwise on a y-down canvas). */
  angle: rotation === 0 ? 0 : -rotation,
});

/** `m` followed by translate(x, y) then rotate(angle degrees), i.e. m * T * R. */
export const placeAffine = (m: Affine, x: number, y: number, angle: number): Affine => {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: m.a * cos + m.c * sin,
    b: m.b * cos + m.d * sin,
    c: -m.a * sin + m.c * cos,
    d: -m.b * sin + m.d * cos,
    e: m.a * x + m.c * y + m.e,
    f: m.b * x + m.d * y + m.f,
  };
};

/** Expanded nodes from the top level down to `id` (inclusive), or null when it is not rendered. */
export const findNodePath = (doc: PegoDocument, id: string): PegoNode[] | null => {
  const search = (nodes: readonly PegoNode[], depth: number): PegoNode[] | null => {
    for (const raw of nodes) {
      const node =
        raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
      if (!node) continue;
      if (node.id === id) return [node];
      if (!isContainer(node)) continue;
      const below = search(node.children, depth + 1);
      if (below) return [node, ...below];
    }
    return null;
  };
  return search(doc.children, 0);
};

/**
 * Matrix taking the node's local space (origin = its box top-left, as `drawContent` paints) to
 * document space, applying every ancestor's position and rotation the way `drawNodes` does.
 */
export const nodeToDocAffine = (
  doc: PegoDocument,
  layout: Layout,
  path: readonly PegoNode[],
): Affine | null => {
  let matrix = IDENTITY;
  let parent: Box = { x: 0, y: 0, width: 0, height: 0 };
  for (const node of path) {
    const box = layout.get(node.id);
    if (!box) return null;
    const { x, y, angle } = nodePlacement(
      box,
      parent,
      resolveNumber(node.rotation, doc.variables, 0),
    );
    matrix = placeAffine(matrix, x, y, angle);
    parent = box;
  }
  return matrix;
};
