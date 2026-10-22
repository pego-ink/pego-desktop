import {
  applyOp,
  cloneWithFreshIds,
  findLocation,
  resolveNumber,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { isFlexChild, topmostSelected } from "./transform";

export type DuplicatePlan = { ops: Op[]; ids: string[] };

const comparePaths = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
};

/**
 * Insert ops that copy `ids` (topmost only) each right after its original, with fresh ids.
 * Copies are shifted by (offset, offset) unless their parent is a flex frame.
 * Returns the ops and the new ids, in document order.
 */
export const duplicateOps = (
  doc: PegoDocument,
  ids: readonly string[],
  offset: number,
): DuplicatePlan => {
  const located = topmostSelected(doc, ids)
    .flatMap((id) => {
      const loc = findLocation(doc, id);
      return loc ? [{ id, loc }] : [];
    })
    .sort((a, b) => comparePaths(a.loc.path, b.loc.path));

  const insertedPerParent = new Map<string | null, number>();
  const ops: Op[] = [];
  const newIds: string[] = [];
  for (const { id, loc } of located) {
    const clone = cloneWithFreshIds(loc.node);
    const shifted =
      offset === 0 || isFlexChild(doc, id)
        ? clone
        : ({
            ...clone,
            x: resolveNumber(loc.node.x, doc.variables, 0) + offset,
            y: resolveNumber(loc.node.y, doc.variables, 0) + offset,
          } as PegoNode);
    const before = insertedPerParent.get(loc.parentId) ?? 0;
    insertedPerParent.set(loc.parentId, before + 1);
    ops.push({
      op: "insert",
      parentId: loc.parentId,
      index: loc.index + 1 + before,
      node: shifted,
    });
    newIds.push(shifted.id);
  }
  return { ops, ids: newIds };
};

/** Document after applying `ops` in order. */
export const applyAll = (doc: PegoDocument, ops: readonly Op[]): PegoDocument =>
  ops.reduce(applyOp, doc);
