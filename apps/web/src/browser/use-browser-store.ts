import { create } from "zustand";
import type { DesktopBrowserState } from "@/desktop/desktop-api";

export const INITIAL_BROWSER_STATE: DesktopBrowserState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  visible: false,
};

/**
 * The in-app browser as the editor sees it. `state` mirrors the desktop view (fed by
 * `connectBrowser` in browser-session.ts); the panel renders it, the browser host waits on it.
 */
type BrowserStore = {
  state: DesktopBrowserState;
  /** The element picker is armed in the page (hover highlights, click picks). */
  picking: boolean;
  /** An element is picked (`target: "selection"` resolves to it); cleared on navigation. */
  hasPicked: boolean;
  setState: (state: DesktopBrowserState) => void;
  setPicking: (picking: boolean) => void;
  setHasPicked: (hasPicked: boolean) => void;
};

export const useBrowserStore = create<BrowserStore>((set) => ({
  state: INITIAL_BROWSER_STATE,
  picking: false,
  hasPicked: false,
  setState: (state) => set({ state }),
  setPicking: (picking) => set({ picking }),
  setHasPicked: (hasPicked) => set({ hasPicked }),
}));
