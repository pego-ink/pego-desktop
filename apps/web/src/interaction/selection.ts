import type { Layout, PegoDocument } from "@pego/doc";
import { getNodeIndex, hitPath, rotationOf, type Point } from "./hit-test";
import type { Box } from "@pego/doc";

/**
 * Figma-style pick: which node of a hit chain a click selects.
 * - deep: the deepest node.
 * - selection already inside a container on the chain: the child of that container (sibling level).
 * - otherwise: one level inside a top-level frame, or the top-level node itself (groups and
 *   leaves are selected as a unit).
 */
export const pickFromPath = (
  doc: PegoDocument,
  path: readonly string[],
  selection: readonly string[],
  deep: boolean,
): string | null => {
  const last = path[path.length - 1];
  if (last === undefined) return null;
  if (deep) return last;

  const index = getNodeIndex(doc);
  const parents = new Set<string>();
  for (const id of selection) {
    const parentId = index.get(id)?.parentId;
    if (parentId) parents.add(parentId);
  }
  for (let j = path.length - 2; j >= 0; j--) {
    const id = path[j];
    const next = path[j + 1];
    if (id !== undefined && next !== undefined && parents.has(id)) return next;
  }

  const first = path[0];
  if (first === undefined) return null;
  const second = path[1];
  return index.get(first)?.type === "frame" && second !== undefined ? second : first;
};

export const pickAt = (
  doc: PegoDocument,
  layout: Layout,
  x: number,
  y: number,
  selection: readonly string[],
  deep: boolean,
  tolerance = 0,
): string | null => {
  const path = hitPath(doc, layout, x, y, tolerance);
  return path ? pickFromPath(doc, path, selection, deep) : null;
};

/** Double-click on a selected container: the child under the cursor, else null. */
export const drillTarget = (
  doc: PegoDocument,
  layout: Layout,
  x: number,
  y: number,
  selection: readonly string[],
): string | null => {
  const path = hitPath(doc, layout, x, y);
  if (!path) return null;
  for (let k = path.length - 2; k >= 0; k--) {
    const id = path[k];
    if (id !== undefined && selection.includes(id)) return path[k + 1] ?? null;
  }
  return null;
};

/** Shift+click: add the id, or remove it when already selected. */
export const toggleSelection = (selection: readonly string[], id: string): string[] =>
  selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];

/** Corners of `box` as drawn: rotated counter-clockwise by `rotation` degrees around its top-left. */
const rotatedCorners = (box: Box, rotation: number): Point[] => {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = [
    [0, 0],
    [box.width, 0],
    [box.width, box.height],
    [0, box.height],
  ] as const;
  // Inverse of hit-test's toLocal: world = top-left + rotate(-rotation) * local.
  return local.map(([lx, ly]) => ({
    x: box.x + lx * cos + ly * sin,
    y: box.y - lx * sin + ly * cos,
  }));
};

const project = (points: readonly Point[], axis: Point) => {
  const dots = points.map((p) => p.x * axis.x + p.y * axis.y);
  return { min: Math.min(...dots), max: Math.max(...dots) };
};

/** Separating axis test for two convex quads; touching edges count as intersecting. */
const convexIntersect = (a: readonly Point[], b: readonly Point[]): boolean => {
  const axes = [a, b].flatMap((poly) =>
    poly.map((p, i) => {
      const next = poly[(i + 1) % poly.length]!;
      return { x: -(next.y - p.y), y: next.x - p.x };
    }),
  );
  return axes.every((axis) => {
    const pa = project(a, axis);
    const pb = project(b, axis);
    return pa.max >= pb.min && pb.max >= pa.min;
  });
};

/** Top-level nodes whose drawn (rotated) shape intersects the marquee. */
export const marqueeSelect = (doc: PegoDocument, layout: Layout, rect: Box): string[] =>
  doc.children.flatMap((node) => {
    const box = layout.get(node.id);
    if (!box) return [];
    const shape = rotatedCorners(box, rotationOf(doc, node));
    return convexIntersect(shape, rotatedCorners(rect, 0)) ? [node.id] : [];
  });

export const normalizeRect = (x1: number, y1: number, x2: number, y2: number): Box => ({
  x: Math.min(x1, x2),
  y: Math.min(y1, y2),
  width: Math.abs(x2 - x1),
  height: Math.abs(y2 - y1),
});

/** Parent selection for Escape: the shared parent, or empty at top level / mixed parents. */
export const escapeSelection = (doc: PegoDocument, selection: readonly string[]): string[] => {
  const index = getNodeIndex(doc);
  const parents = new Set(selection.map((id) => index.get(id)?.parentId ?? null));
  const [only] = parents;
  return parents.size === 1 && only ? [only] : [];
};
