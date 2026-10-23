import { create } from "zustand";
import { motionEnd, type PegoDocument } from "@pego/doc";
import { activePage, useDocumentStore } from "@/store/use-document-store";

/** A little tail after the last entrance so it lands on its final frame before the preview stops. */
const TAIL_MS = 120;

type MotionState = {
  /** `performance.now()` when the preview started; null when nothing plays. */
  startedAt: number | null;
  /** The page being played: switching pages stops the preview. */
  pageId: string | null;
  /**
   * Play every animation on the shown page from the start. Returns false (and plays nothing) when
   * the page has none.
   */
  play: () => boolean;
  stop: () => void;
};

/** When the shown page's last entrance ends (plus the tail), for the document as it is now. */
let endCache: { doc: PegoDocument; pageId: string | null; end: number } | null = null;
const pageEnd = (): number => {
  const state = useDocumentStore.getState();
  if (endCache?.doc !== state.doc || endCache.pageId !== state.pageId) {
    const end = motionEnd(state.doc, activePage(state).children);
    endCache = { doc: state.doc, pageId: state.pageId, end: end === 0 ? 0 : end + TAIL_MS };
  }
  return endCache.end;
};

export const useMotionStore = create<MotionState>((set) => ({
  startedAt: null,
  pageId: null,
  play: () => {
    if (pageEnd() === 0) return false;
    set({ startedAt: performance.now(), pageId: useDocumentStore.getState().pageId });
    return true;
  },
  stop: () => set({ startedAt: null }),
}));

/**
 * Milliseconds into the running preview, for the renderer; undefined when nothing plays. The end
 * follows edits made while it plays (an added entrance is not cut short); the preview stops once
 * it is past the last entrance, or when another page is shown.
 */
export const currentMotionTime = (now = performance.now()): number | undefined => {
  const { startedAt, pageId, stop } = useMotionStore.getState();
  if (startedAt === null) return undefined;
  const time = now - startedAt;
  if (useDocumentStore.getState().pageId === pageId && time <= pageEnd()) return time;
  stop();
  return undefined;
};
