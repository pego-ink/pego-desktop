import { resolveNumber, type Box, type Op, type PegoDocument } from "@pego/doc";
import { findNode } from "@pego/doc";
import { getNodeIndex } from "./hit-test";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

const round = (v: number) => Math.round(v * 100) / 100;

/** Handle position on a (screen or doc) box. */
export const handlePoint = (box: Box, handle: Handle) => ({
  x: handle.includes("w")
    ? box.x
    : handle.includes("e")
      ? box.x + box.width
      : box.x + box.width / 2,
  y: handle.includes("n")
    ? box.y
    : handle.includes("s")
      ? box.y + box.height
      : box.y + box.height / 2,
});

/** Handle whose center is within `radius` of the screen point, or null. */
export const hitHandle = (screenBox: Box, x: number, y: number, radius: number): Handle | null => {
  for (const handle of HANDLES) {
    const p = handlePoint(screenBox, handle);
    if (Math.abs(p.x - x) <= radius && Math.abs(p.y - y) <= radius) return handle;
  }
  return null;
};

/** Keep only the dominant axis of a drag delta. */
export const constrainAxis = (dx: number, dy: number) =>
  Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };

/**
 * New box for dragging `handle` by (dx, dy) in doc units. Min size 1px (no flipping).
 * shift keeps the start aspect ratio, alt resizes symmetrically from the center.
 */
export const resizeBox = (
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  opts: { shift?: boolean; alt?: boolean } = {},
): Box => {
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const k = opts.alt ? 2 : 1;
  let width = Math.max(1, sx === 0 ? start.width : start.width + sx * dx * k);
  let height = Math.max(1, sy === 0 ? start.height : start.height + sy * dy * k);

  if (opts.shift && start.width > 0 && start.height > 0) {
    if (sx !== 0 && sy !== 0) {
      const scale = Math.max(width / start.width, height / start.height);
      width = Math.max(1, start.width * scale);
      height = Math.max(1, start.height * scale);
    } else if (sx !== 0) {
      height = Math.max(1, (width * start.height) / start.width);
    } else {
      width = Math.max(1, (height * start.width) / start.height);
    }
  }

  const x =
    opts.alt || sx === 0
      ? start.x + (start.width - width) / 2
      : sx === 1
        ? start.x
        : start.x + start.width - width;
  const y =
    opts.alt || sy === 0
      ? start.y + (start.height - height) / 2
      : sy === 1
        ? start.y
        : start.y + start.height - height;
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
};

/** True when the parent frame positions its children itself (flex). */
export const isFlexChild = (doc: PegoDocument, id: string): boolean => {
  const parentId = getNodeIndex(doc).get(id)?.parentId;
  if (!parentId) return false;
  const parent = findNode(doc, parentId);
  return parent?.type === "frame" && parent.layout !== "none";
};

/** Selected ids minus any whose ancestor is also selected (they move with the ancestor). */
export const topmostSelected = (doc: PegoDocument, ids: readonly string[]): string[] => {
  const index = getNodeIndex(doc);
  const set = new Set(ids);
  return ids.filter((id) => {
    let parent = index.get(id)?.parentId ?? null;
    while (parent) {
      if (set.has(parent)) return false;
      parent = index.get(parent)?.parentId ?? null;
    }
    return index.has(id);
  });
};

/** Absolute `update` ops that move `ids` by (dx, dy) from `startDoc` positions. */
export const moveOps = (
  startDoc: PegoDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): Op[] =>
  topmostSelected(startDoc, ids).flatMap((id): Op[] => {
    const node = findNode(startDoc, id);
    if (!node || isFlexChild(startDoc, id)) return [];
    const x = resolveNumber(node.x, startDoc.variables, 0);
    const y = resolveNumber(node.y, startDoc.variables, 0);
    return [{ op: "update", id, props: { x: round(x + dx), y: round(y + dy) } }];
  });

/** Absolute `update` op that resizes one node from its start state to `next` (doc coords). */
export const resizeOps = (startDoc: PegoDocument, id: string, startBox: Box, next: Box): Op[] => {
  const node = findNode(startDoc, id);
  if (!node) return [];
  const props: Record<string, number> = { width: next.width, height: next.height };
  if (!isFlexChild(startDoc, id)) {
    props.x = round(resolveNumber(node.x, startDoc.variables, 0) + next.x - startBox.x);
    props.y = round(resolveNumber(node.y, startDoc.variables, 0) + next.y - startBox.y);
  }
  return [{ op: "update", id, props }];
};

/** `update` ops that shift selected nodes by (dx, dy) from the current document (nudge). */
export const nudgeOps = moveOps;
