import { findNode, type Layout, type Op, type PegoDocument } from "@pego/doc";
import { getNodeIndex } from "./hit-test";

/** The ids whose parent is a horizontal or vertical frame (where `layoutPosition` matters). */
export const flexChildren = (doc: PegoDocument, ids: readonly string[]): string[] => {
  const index = getNodeIndex(doc);
  return ids.filter((id) => {
    const parentId = index.get(id)?.parentId;
    const parent = parentId ? findNode(doc, parentId) : null;
    return parent?.type === "frame" && parent.layout !== "none";
  });
};

/**
 * Ops that take children of flex frames out of the flow (`absolute`) or put them back. Taking
 * one out keeps it where the layout drew it: its x/y become its offset in the parent.
 */
export const layoutPositionOps = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
  absolute: boolean,
): Op[] => {
  const index = getNodeIndex(doc);
  return flexChildren(doc, ids).map((id): Op => {
    if (!absolute) return { op: "update", id, props: { layoutPosition: null } };
    const box = layout.get(id);
    const parentId = index.get(id)?.parentId;
    const parentBox = parentId ? layout.get(parentId) : undefined;
    const at =
      box && parentBox
        ? { x: Math.round(box.x - parentBox.x), y: Math.round(box.y - parentBox.y) }
        : {};
    return { op: "update", id, props: { layoutPosition: "absolute", ...at } };
  });
};
