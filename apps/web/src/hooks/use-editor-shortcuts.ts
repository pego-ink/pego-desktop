import { useEffect } from "react";
import type { Op } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { useInteractionState } from "@/interaction/interaction-state";
import { escapeSelection } from "@/interaction/selection";
import { nudgeOps, topmostSelected } from "@/interaction/transform";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const ZOOM_STEP = 1.25;

/** Global editor keyboard shortcuts: history, delete, nudge, selection, zoom, space-to-pan. */
export const useEditorShortcuts = () => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
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
        viewport.zoomToFit(contentBounds(doc.doc, getLayout(doc.doc)));
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
        doc.select(doc.doc.children.map((n) => n.id));
        return;
      }
      if (mod) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = topmostSelected(doc.doc, doc.selection);
        if (ids.length === 0) return;
        e.preventDefault();
        const ops: Op[] = ids.map((id) => ({ op: "delete", id }));
        doc.commit(ops, { label: "Delete" });
        return;
      }
      if (e.key === "Escape") {
        doc.select(escapeSelection(doc.doc, doc.selection));
        return;
      }
      const arrow = ARROW_DELTAS[e.key];
      if (arrow && doc.selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
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
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
};
