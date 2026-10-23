import { getLayout } from "@/canvas/layout";
import { useDocumentStore } from "@/store/use-document-store";
import { flipOps, type FlipAxis } from "./flip-ops";

export type { FlipAxis };

/**
 * Flip the selection (⇧H = "x", ⇧V = "y") as one undo step. Toggles flipX / flipY on every
 * selected layer and, for several layers, mirrors their positions inside the selection bounds.
 * Returns false when nothing was flipped.
 */
export const flipSelection = (axis: FlipAxis): boolean => {
  const state = useDocumentStore.getState();
  const ops = flipOps(state.doc, getLayout(state.doc), state.selection, axis);
  if (ops.length === 0) return false;
  return state.commit(ops, { label: axis === "x" ? "Flip horizontal" : "Flip vertical" });
};
