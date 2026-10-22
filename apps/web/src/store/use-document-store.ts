import { create } from "zustand";
import { toast } from "sonner";
import {
  collectDocIds,
  commit as commitOps,
  emptyHistory,
  extendLast as extendLastOps,
  OpError,
  planRunUndo,
  pageOrFirst,
  placeOnPage,
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
  /** The page shown on the canvas; null = the first page. Read it through `activePage`. */
  pageId: string | null;

  /** Apply ops as one undo step. Returns false (and toasts) when an op does not fit the doc. */
  commit: (ops: Op[], meta?: CommitMeta) => boolean;
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
  /** Show another page: clears selection and hover. */
  setPage: (pageId: string) => void;
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

/** UI code builds ops with `parentId: null` for "the top level": that is the shown page. */
const onShownPage = (doc: PegoDocument, pageId: string | null, ops: Op[]): Op[] => {
  const page = pageOrFirst(doc, pageId).id;
  return ops.map((op) => placeOnPage(doc, op, page));
};

/** The page shown on the canvas (falls back to the first when the stored one is gone). */
export const activePage = (state: { doc: PegoDocument; pageId: string | null }) =>
  pageOrFirst(state.doc, state.pageId);

/**
 * The editable core of a document's state. The store holds the visible document's; a background
 * tab keeps the same fields in its snapshot (see workspace/document-target.ts), so both go
 * through the pure transitions below.
 */
export type DocumentCore = {
  doc: PegoDocument;
  history: History;
  selection: string[];
  hoveredId: string | null;
  pageId: string | null;
};

export type CommitMeta = { label?: string; source?: TransactionSource; runId?: string };

/** `ops` as one new undo step. Throws `OpError` when an op does not fit the document. */
export const commitCore = (state: DocumentCore, ops: Op[], meta?: CommitMeta) => {
  const { doc, history, selection, hoveredId, pageId } = state;
  const next = commitOps(doc, history, onShownPage(doc, pageId, ops), {
    source: meta?.source ?? "user",
    label: meta?.label,
    ...(meta?.runId ? { runId: meta.runId } : {}),
  });
  return {
    doc: next.doc,
    history: next.history,
    ...pruneSelection(next.doc, selection, hoveredId),
  };
};

/** `ops` folded into the last undo step. Throws `OpError` when an op does not fit. */
export const extendCore = (state: DocumentCore, ops: Op[]) => {
  const { doc, history, selection, hoveredId, pageId } = state;
  const next = extendLastOps(doc, history, onShownPage(doc, pageId, ops));
  return {
    doc: next.doc,
    history: next.history,
    ...pruneSelection(next.doc, selection, hoveredId),
  };
};

type RunUndoCheck = { ok: boolean; message?: string };
const checkCache = new WeakMap<History, { doc: PegoDocument; byRun: Map<string, RunUndoCheck> }>();

/** Can one run's changes be reverted in this state (cached per history and document)? */
export const checkRunUndo = (
  state: Pick<DocumentCore, "doc" | "history">,
  runId: string,
): RunUndoCheck => {
  const { doc, history } = state;
  const cached = checkCache.get(history);
  const entry = cached?.doc === doc ? cached : { doc, byRun: new Map<string, RunUndoCheck>() };
  checkCache.set(history, entry);
  const hit = entry.byRun.get(runId);
  if (hit) return hit;
  const plan = planRunUndo(doc, history, runId);
  const result: RunUndoCheck = plan.ok ? { ok: true } : { ok: false, message: plan.message };
  entry.byRun.set(runId, result);
  return result;
};

const reportOpError = (error: unknown): false => {
  if (!(error instanceof OpError)) throw error;
  console.warn(error);
  toast.error(error.message);
  return false;
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  doc: showcaseDoc,
  history: emptyHistory(),
  selection: [],
  hoveredId: null,
  pageId: null,

  commit: (ops, meta) => {
    try {
      set(commitCore(get(), ops, meta));
      return true;
    } catch (error) {
      return reportOpError(error);
    }
  },

  extendLast: (ops) => {
    try {
      set(extendCore(get(), ops));
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

  canUndoRun: (runId) => checkRunUndo(get(), runId),

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
  setPage: (pageId) => set({ pageId, selection: [], hoveredId: null }),
  load: (doc) =>
    set({ doc, history: emptyHistory(), selection: [], hoveredId: null, pageId: null }),
  setHovered: (id) => set({ hoveredId: id }),
}));
