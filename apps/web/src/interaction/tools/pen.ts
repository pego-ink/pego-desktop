// Pen tool: draw vector paths (click = corner, drag = smooth anchor) and edit existing ones.
// Draw mode lives in ../pen/draw-mode.ts, edit mode ("pen" tool in its edit sub-mode) in
// ../pen/edit-mode.ts. Pure geometry/serialising helpers are in ../pen/*.ts.
import { findNode } from "@pego/doc";
import { registerToolHandler, type ToolHandler } from "@/interaction/tool-handlers";
import { isTextEditing } from "@/store/use-text-edit-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";
import {
  drawBegin,
  drawHover,
  drawKeyDown,
  drawOverlay,
  finishDraw,
  resetDraw,
} from "@/interaction/pen/draw-mode";
import {
  editBegin,
  editHover,
  editKeyDown,
  editOverlay,
  enterEdit,
  isEditing,
  resetEdit,
} from "@/interaction/pen/edit-mode";

/** Enter path edit mode for a path node (double-click or Enter with the select tool). */
export const enterPathEdit = (id: string): boolean => enterEdit(id);

const penHandler: ToolHandler = {
  begin: (p) => (isEditing() ? editBegin(p) : drawBegin(p)),
  hover: (p) => (isEditing() ? editHover(p) : drawHover(p)),
  onKeyDown: (e) => (isEditing() ? editKeyDown(e) : drawKeyDown(e)),
  deactivate: () => {
    // Switching tools finishes an open path; edits are already committed gesture by gesture.
    if (isEditing()) resetEdit();
    else {
      finishDraw(false);
      resetDraw();
    }
  },
  renderOverlay: (res, canvas, camera) =>
    isEditing() ? editOverlay(res, canvas, camera) : drawOverlay(res, canvas, camera),
  hidesSelection: isEditing,
  get cursor() {
    return isEditing() ? "default" : "crosshair";
  },
};

registerToolHandler("pen", penHandler);

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Enter with a single path selected (select tool) opens edit mode. */
const onEnterKey = (e: KeyboardEvent) => {
  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  if (isEditableTarget(e.target) || isTextEditing()) return;
  if (useToolStore.getState().tool !== "select") return;
  const { doc, selection } = useDocumentStore.getState();
  const [id] = selection;
  if (selection.length !== 1 || !id || findNode(doc, id)?.type !== "path") return;
  if (!enterEdit(id, e.timeStamp)) return;
  e.preventDefault();
  // The editor-wide shortcut listener must not also see this Enter (it would exit at once).
  e.stopImmediatePropagation();
};

if (typeof window !== "undefined") {
  window.addEventListener("keydown", onEnterKey);
  import.meta.hot?.dispose(() => window.removeEventListener("keydown", onEnterKey));
}
