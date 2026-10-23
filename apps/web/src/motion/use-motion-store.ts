import { create } from "zustand";
import { motionEnd } from "@pego/doc";
import { activePage, useDocumentStore } from "@/store/use-document-store";

/** A little tail after the last entrance so it lands on its final frame before the preview stops. */
const TAIL_MS = 120;

type MotionState = {
  /** `performance.now()` when the preview started; null when nothing plays. */
  startedAt: number | null;
  /** When the preview ends, in ms after `startedAt`. */
  end: number;
  /**
   * Play every animation on the shown page from the start. Returns false (and plays nothing) when
   * the page has none.
   */
  play: () => boolean;
  stop: () => void;
};

export const useMotionStore = create<MotionState>((set) => ({
  startedAt: null,
  end: 0,
  play: () => {
    const state = useDocumentStore.getState();
    const end = motionEnd(state.doc, activePage(state).children);
    if (end === 0) return false;
    set({ startedAt: performance.now(), end: end + TAIL_MS });
    return true;
  },
  stop: () => set({ startedAt: null }),
}));

/**
 * Milliseconds into the running preview, for the renderer; undefined when nothing plays. Ends the
 * preview once it is past its last entrance.
 */
export const currentMotionTime = (now = performance.now()): number | undefined => {
  const { startedAt, end, stop } = useMotionStore.getState();
  if (startedAt === null) return undefined;
  const time = now - startedAt;
  if (time <= end) return time;
  stop();
  return undefined;
};
