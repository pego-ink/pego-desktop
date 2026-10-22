import type { Layout, PegoDocument } from "@pego/doc";
import { boxesIntersect, getNodeIndex, hitPath } from "./hit-test";
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
): string | null => {
  const path = hitPath(doc, layout, x, y);
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

/** Top-level nodes whose box intersects the marquee. */
export const marqueeSelect = (doc: PegoDocument, layout: Layout, rect: Box): string[] =>
  doc.children.flatMap((node) => {
    const box = layout.get(node.id);
    return box && boxesIntersect(box, rect) ? [node.id] : [];
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
