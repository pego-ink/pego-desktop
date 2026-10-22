import {
  collectIds,
  findLocation,
  findNode,
  isContainer,
  type MoveOp,
  type PegoDocument,
} from "@pego/doc";

export type DropZone = "before" | "after" | "inside";

/**
 * Where a pointer at `ratio` (0 top .. 1 bottom) of a row's height drops.
 * Containers get a middle "inside" band; other rows split in halves.
 */
export const dropZoneAt = (ratio: number, targetIsContainer: boolean): DropZone => {
  if (!targetIsContainer) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
};

/**
 * Build the `move` op for dropping `dragId` on `targetId`, or null when the drop is invalid
 * (onto itself, into itself or a descendant, into a non-container) or changes nothing.
 * `move.index` is the final index in the target parent, so removal of the dragged node
 * from the same parent is accounted for.
 */
export const buildMoveOp = (
  doc: PegoDocument,
  dragId: string,
  targetId: string,
  zone: DropZone,
): MoveOp | null => {
  if (dragId === targetId) return null;
  const drag = findLocation(doc, dragId);
  const target = findLocation(doc, targetId);
  if (!drag || !target) return null;

  const parentId = zone === "inside" ? target.node.id : target.parentId;
  if (zone === "inside" && !isContainer(target.node)) return null;
  if (parentId !== null && collectIds(drag.node).has(parentId)) return null;

  const siblings =
    parentId === null
      ? doc.children
      : (() => {
          const parent = findNode(doc, parentId);
          return parent && isContainer(parent) ? parent.children : [];
        })();
  const sameParent = drag.parentId === parentId;

  const rawIndex = zone === "inside" ? siblings.length : target.index + (zone === "after" ? 1 : 0);
  const index = sameParent && drag.index < rawIndex ? rawIndex - 1 : rawIndex;
  if (sameParent && index === drag.index) return null;

  return { op: "move", id: dragId, parentId, index };
};
