import { create } from "zustand";
import { toast } from "sonner";
import {
  collectDocIds,
  commit as commitOps,
  emptyHistory,
  extendLast as extendLastOps,
  OpError,
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
  commit: (ops: Op[], meta?: { label?: string; source?: TransactionSource }) => boolean;
  /**
   * Fold ops into the last undo step, for continuous gestures (drag, resize, scrubbing).
   * Start the gesture with `commit`, then call this on every further change.
   */
  extendLast: (ops: Op[]) => boolean;
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
    const { doc, history, selection, hoveredId, pageId } = get();
    try {
      const next = commitOps(doc, history, onShownPage(doc, pageId, ops), {
        source: meta?.source ?? "user",
        label: meta?.label,
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
    const { doc, history, selection, hoveredId, pageId } = get();
    try {
      const next = extendLastOps(doc, history, onShownPage(doc, pageId, ops));
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
