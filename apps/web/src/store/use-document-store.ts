import { create } from "zustand";
import { toast } from "sonner";
import {
  collectDocIds,
  commit as commitOps,
  emptyHistory,
  extendLast as extendLastOps,
  OpError,
  planRunUndo,
  redo as redoOps,
  undo as undoOps,
  type History,
  type Op,
  type PegoDocument,
  type TransactionSource,
} from "@pego/doc";
import { showcaseDoc } from "@/dev/showcase-doc";

type DocumentState = {
  doc: PegoDocument;
  history: History;
  /** Selected node ids (top-level document ids; instance internals select their instance). */
  selection: string[];
  hoveredId: string | null;

  /** Apply ops as one undo step. Returns false (and toasts) when an op does not fit the doc. */
  commit: (
    ops: Op[],
    meta?: { label?: string; source?: TransactionSource; runId?: string },
  ) => boolean;
  /**
   * Fold ops into the last undo step, for continuous gestures (drag, resize, scrubbing).
   * Start the gesture with `commit`, then call this on every further change.
   */
  extendLast: (ops: Op[]) => boolean;
  /** Revert only one agent run as ONE new undo step. Fails with a reason on conflict. */
  undoRun: (runId: string) => { ok: boolean; message?: string };
  /** Cheap check for UI: can the run be reverted right now? */
  canUndoRun: (runId: string) => { ok: boolean; message?: string };
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  /** Replace the whole document (open file, restore autosave). Clears history and selection. */
  load: (doc: PegoDocument) => void;
  setHovered: (id: string | null) => void;
};

/** Drop selected/hovered ids that no longer exist after the document changed. */
const pruneSelection = (doc: PegoDocument, selection: string[], hoveredId: string | null) => {
  const ids = collectDocIds(doc);
  return {
    selection: selection.filter((id) => ids.has(id)),
    hoveredId: hoveredId && ids.has(hoveredId) ? hoveredId : null,
  };
};

const reportOpError = (error: unknown): false => {
  if (!(error instanceof OpError)) throw error;
  console.warn(error);
  toast.error(error.message);
  return false;
};

type RunUndoCheck = { ok: boolean; message?: string };
const checkCache = new WeakMap<History, { doc: PegoDocument; byRun: Map<string, RunUndoCheck> }>();

export const useDocumentStore = create<DocumentState>((set, get) => ({
  doc: showcaseDoc,
  history: emptyHistory(),
  selection: [],
  hoveredId: null,

  commit: (ops, meta) => {
    const { doc, history, selection, hoveredId } = get();
    try {
      const next = commitOps(doc, history, ops, {
        source: meta?.source ?? "user",
        label: meta?.label,
        ...(meta?.runId ? { runId: meta.runId } : {}),
      });
      set({
        doc: next.doc,
        history: next.history,
        ...pruneSelection(next.doc, selection, hoveredId),
      });
      return true;
    } catch (error) {
      return reportOpError(error);
    }
  },

  extendLast: (ops) => {
    const { doc, history, selection, hoveredId } = get();
    try {
      const next = extendLastOps(doc, history, ops);
      set({
        doc: next.doc,
        history: next.history,
        ...pruneSelection(next.doc, selection, hoveredId),
      });
      return true;
    } catch (error) {
      return reportOpError(error);
    }
  },

  undoRun: (runId) => {
    const { doc, history } = get();
    const plan = planRunUndo(doc, history, runId);
    if (!plan.ok) return { ok: false, message: plan.message };
    const ok = get().commit(plan.ops, { source: "user", label: plan.label });
    return ok ? { ok } : { ok, message: "Could not apply the undo" };
  },

  canUndoRun: (runId) => {
    const { doc, history } = get();
    const cached = checkCache.get(history);
    const entry = cached?.doc === doc ? cached : { doc, byRun: new Map<string, RunUndoCheck>() };
    checkCache.set(history, entry);
    const hit = entry.byRun.get(runId);
    if (hit) return hit;
    const plan = planRunUndo(doc, history, runId);
    const result: RunUndoCheck = plan.ok ? { ok: true } : { ok: false, message: plan.message };
    entry.byRun.set(runId, result);
    return result;
  },

  undo: () => {
    const { doc, history, selection, hoveredId } = get();
    const next = undoOps(doc, history);
    if (!next) return;
    set({ ...next, ...pruneSelection(next.doc, selection, hoveredId) });
  },

  redo: () => {
    const { doc, history, selection, hoveredId } = get();
    const next = redoOps(doc, history);
    if (!next) return;
    set({ ...next, ...pruneSelection(next.doc, selection, hoveredId) });
  },

  select: (ids) => set({ selection: ids }),
  load: (doc) => set({ doc, history: emptyHistory(), selection: [], hoveredId: null }),
  setHovered: (id) => set({ hoveredId: id }),
}));
