import { useEffect } from "react";
import { findNode, type Op } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { ZOOM_STEP, selectionBounds } from "@/interaction/zoom-utils";
import { useInteractionState } from "@/interaction/interaction-state";
import { duplicateOps } from "@/interaction/duplicate";
import { escapeSelection } from "@/interaction/selection";
import { nudgeOps, topmostSelected } from "@/interaction/transform";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { isTextEditing, useTextEditStore } from "@/store/use-text-edit-store";
import { SHIFT_TOOL_KEYS, TOOL_KEYS, useToolStore } from "@/store/use-tool-store";
import { getToolHandler } from "@/interaction/tool-handlers";
import { nudgeStep } from "@/interaction/nudge";
import { useSelectionPrompt } from "@/store/use-selection-prompt-store";
import { useSettingsModal, useSettingsStore } from "@/store/use-settings-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { desktopApi } from "@/desktop/desktop-api";

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

/** Select every top-level node of the shown page (never the surrounding UI text). */
const selectAllNodes = () => {
  const state = useDocumentStore.getState();
  state.select(activePage(state).children.map((n) => n.id));
};

/**
 * Desktop "Select All" menu item: select the text of a focused field, otherwise the canvas
 * nodes. Behind the settings modal it does nothing.
 */
const onMenuSelectAll = () => {
  if (isEditable(document.activeElement) || isTextEditing()) {
    document.execCommand("selectAll");
    return;
  }
  if (useSettingsModal.getState().open) return;
  selectAllNodes();
};

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const DUPLICATE_OFFSET = 10;

/** Global editor keyboard shortcuts: history, delete, nudge, selection, zoom, space-to-pan. */
export const useEditorShortcuts = () => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Settings: Cmd/Ctrl+, works everywhere, even inside inputs.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        const { tab, openSettings } = useSettingsModal.getState();
        openSettings(tab);
        return;
      }
      // The settings modal owns the keyboard: no tool keys, delete or nudge behind it.
      if (useSettingsModal.getState().open) return;
      if (isEditable(e.target) || isTextEditing()) return;
      // The active tool gets first pick (e.g. the pen finishing a path on Enter/Escape).
      if (getToolHandler(useToolStore.getState().tool)?.onKeyDown?.(e)) {
        e.preventDefault();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const doc = useDocumentStore.getState();
      const viewport = useViewportStore.getState();

      if (e.code === "Space" && !mod) {
        e.preventDefault();
        if (!useInteractionState.getState().spaceDown)
          useInteractionState.getState().set({ spaceDown: true });
        return;
      }

      // Zoom shortcuts
      if (e.code === "Digit0" && (e.shiftKey || mod)) {
        e.preventDefault();
        viewport.zoomCenterTo(1);
        return;
      }
      if (e.code === "Digit1" && e.shiftKey && !mod) {
        e.preventDefault();
        viewport.zoomToFit(contentBounds(doc.doc, getLayout(doc.doc), doc.pageId));
        return;
      }
      if (e.code === "Digit2" && e.shiftKey && !mod) {
        e.preventDefault();
        viewport.zoomToFit(selectionBounds(getLayout(doc.doc), doc.selection, doc.doc));
        return;
      }
      if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
        e.preventDefault();
        viewport.zoomCenterBy(e.key === "-" || e.key === "_" ? 1 / ZOOM_STEP : ZOOM_STEP);
        return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doc.redo();
        else doc.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doc.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllNodes();
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useToolStore.getState().setTool("image");
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const plan = duplicateOps(doc.doc, doc.selection, DUPLICATE_OFFSET);
        if (plan.ops.length === 0) return;
        if (doc.commit(plan.ops, { label: "Duplicate" }))
          useDocumentStore.getState().select(plan.ids);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (doc.selection.length > 0) useSelectionPrompt.getState().toggle();
        return;
      }
      if (mod) return;

      const shiftTool = e.shiftKey && !e.altKey ? SHIFT_TOOL_KEYS[e.key.toLowerCase()] : undefined;
      if (shiftTool) {
        e.preventDefault();
        useToolStore.getState().setTool(shiftTool);
        return;
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        useToolStore.getState().setTool(tool);
        return;
      }
      if (e.key === "Enter" && doc.selection.length === 1) {
        const [id] = doc.selection;
        const node = id ? findNode(doc.doc, id) : null;
        if (node?.type === "text") {
          e.preventDefault();
          useTextEditStore.getState().start({ mode: "edit", id: node.id });
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = topmostSelected(doc.doc, doc.selection);
        if (ids.length === 0) return;
        e.preventDefault();
        const ops: Op[] = ids.map((id) => ({ op: "delete", id }));
        doc.commit(ops, { label: "Delete" });
        return;
      }
      if (e.key === "Escape") {
        if (useToolStore.getState().tool !== "select") {
          useToolStore.getState().setTool("select");
          return;
        }
        doc.select(escapeSelection(doc.doc, doc.selection));
        return;
      }
      const arrow = ARROW_DELTAS[e.key];
      if (arrow && doc.selection.length > 0) {
        e.preventDefault();
        const step = nudgeStep(e.shiftKey, useSettingsStore.getState());
        const ops = nudgeOps(doc.doc, doc.selection, arrow[0] * step, arrow[1] * step);
        if (ops.length > 0) doc.commit(ops, { label: "Nudge" });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") useInteractionState.getState().set({ spaceDown: false });
    };
    const onBlur = () => useInteractionState.getState().set({ spaceDown: false });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    const offMenu = desktopApi()?.onMenuCommand?.((command) => {
      if (command === "select-all") onMenuSelectAll();
    });
    return () => {
      offMenu?.();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
};
