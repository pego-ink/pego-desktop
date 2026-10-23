import { toast } from "sonner";
import { pageOf } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { duplicateOps } from "./duplicate";
import { topmostSelected } from "./transform";
import { showPage } from "@/pages/page-actions";
import { selectionBounds } from "./zoom-utils";
import { addFlexLayout, removeFlexLayout } from "./flex-layout";
import {
  componentOf,
  detachInstances,
  restack,
  toggleClip,
  toggleVisible,
  toggleComponent,
  ungroupSelection,
  wrapSelection,
  type StructureResult,
} from "./structure";

export type StructureAction =
  | "group"
  | "frame"
  | "ungroup"
  | "component"
  | "detach-instance"
  | "front"
  | "back"
  | "add-flex"
  | "remove-flex"
  | "toggle-visible"
  | "toggle-clip";

const planFor = (action: StructureAction): StructureResult => {
  const { doc, selection } = useDocumentStore.getState();
  const layout = getLayout(doc);
  switch (action) {
    case "group":
      return wrapSelection(doc, layout, selection, "group");
    case "frame":
      return wrapSelection(doc, layout, selection, "frame");
    case "ungroup":
      return ungroupSelection(doc, layout, selection);
    case "component":
      return toggleComponent(doc, layout, selection);
    case "detach-instance":
      return detachInstances(doc, selection);
    case "add-flex":
      return addFlexLayout(doc, layout, selection);
    case "remove-flex":
      return removeFlexLayout(doc, layout, selection);
    case "toggle-visible":
      return toggleVisible(doc, selection);
    case "toggle-clip":
      return toggleClip(doc, selection);
    case "front":
    case "back":
      return restack(doc, selection, action);
  }
};

/** Run a structure action on the selection as one undo step; says why when it cannot. */
export const runStructure = (action: StructureAction): boolean => {
  const plan = planFor(action);
  if ("error" in plan) {
    toast(plan.error);
    return false;
  }
  const state = useDocumentStore.getState();
  if (!state.commit(plan.ops, { label: plan.label })) return false;
  state.select(plan.select);
  return true;
};

/** Go to component: select the instance's component (on its page) and zoom to it. */
export const goToComponent = (instanceId: string): boolean => {
  const state = useDocumentStore.getState();
  const componentId = componentOf(state.doc, instanceId);
  if (!componentId) {
    toast("This instance's component is not in this file.");
    return false;
  }
  const page = pageOf(state.doc, componentId);
  if (page && page.id !== state.pageId) showPage(page.id);
  useDocumentStore.getState().select([componentId]);
  const { doc } = useDocumentStore.getState();
  useViewportStore.getState().zoomToFit(selectionBounds(getLayout(doc), [componentId], doc));
  return true;
};

/** Offset of a duplicate from its original (canvas px; none inside flex frames). */
export const DUPLICATE_OFFSET = 10;

/** Duplicate (⌘D): copies next to the originals, then selected. */
export const runDuplicate = (): boolean => {
  const state = useDocumentStore.getState();
  const plan = duplicateOps(state.doc, state.selection, DUPLICATE_OFFSET);
  if (plan.ops.length === 0) return false;
  if (!state.commit(plan.ops, { label: "Duplicate" })) return false;
  useDocumentStore.getState().select(plan.ids);
  return true;
};

/** Delete the selected layers (their selected descendants go with them). */
export const runDelete = (): boolean => {
  const state = useDocumentStore.getState();
  const ids = topmostSelected(state.doc, state.selection);
  if (ids.length === 0) return false;
  return state.commit(
    ids.map((id) => ({ op: "delete", id })),
    { label: "Delete" },
  );
};
