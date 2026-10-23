import {
  MAX_INSTANCE_DEPTH,
  flipOf,
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

/**
 * `m` followed by a mirror around the center of a width x height box (flipX negates x, flipY
 * negates y), i.e. m * T(c) * S * T(-c). Returns `m` itself when neither flag is set.
 */
export const flipAffine = (
  m: Affine,
  flipX: boolean,
  flipY: boolean,
  width: number,
  height: number,
): Affine => {
  if (!flipX && !flipY) return m;
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  const cx = width / 2;
  const cy = height / 2;
  const tx = cx - sx * cx;
  const ty = cy - sy * cy;
  return {
    a: m.a * sx,
    b: m.b * sx,
    c: m.c * sy,
    d: m.d * sy,
    e: m.a * tx + m.c * ty + m.e,
    f: m.b * tx + m.d * ty + m.f,
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
  // Pages have no box (their content uses canvas coordinates): paths start below them.
  return search(
    doc.children.flatMap((page) => page.children),
    0,
  );
};

/**
 * Matrix taking the node's local space (origin = its box top-left, as `drawContent` paints) to
 * document space, applying every ancestor's position, rotation and flip the way `drawNodes` does.
 * `ownFlip: false` leaves the last node's own mirror out: its box maps onto itself either way, but
 * resize math and drag origins want the frame whose corners are not swapped.
 */
export const nodeToDocAffine = (
  doc: PegoDocument,
  layout: Layout,
  path: readonly PegoNode[],
  ownFlip = true,
): Affine | null => {
  let matrix = IDENTITY;
  let parent: Box = { x: 0, y: 0, width: 0, height: 0 };
  for (const [index, node] of path.entries()) {
    const box = layout.get(node.id);
    if (!box) return null;
    const { x, y, angle } = nodePlacement(
      box,
      parent,
      resolveNumber(node.rotation, doc.variables, 0),
    );
    matrix = placeAffine(matrix, x, y, angle);
    if (ownFlip || index < path.length - 1) {
      const flip = flipOf(node);
      matrix = flipAffine(matrix, flip.x, flip.y, box.width, box.height);
    }
    parent = box;
  }
  return matrix;
};

/** Map a point through `m`. */
export const applyAffine = (m: Affine, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

/** Inverse of `m`, or null when it is singular. */
export const invertAffine = (m: Affine): Affine | null => {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
};
