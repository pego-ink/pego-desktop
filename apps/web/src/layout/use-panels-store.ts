import { create } from "zustand";

/** Which side panels are shown. Remembered per browser. */
type PanelsState = { left: boolean; right: boolean };

const STORAGE_KEY = "pego.panels";

const read = (): PanelsState => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<PanelsState>;
    return { left: stored.left !== false, right: stored.right !== false };
  } catch {
    return { left: true, right: true };
  }
};

export const usePanelsStore = create<PanelsState>(() =>
  typeof localStorage === "undefined" ? { left: true, right: true } : read(),
);

usePanelsStore.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the choice lasts for this session.
  }
});

export const togglePanel = (side: keyof PanelsState): void =>
  usePanelsStore.setState((state) => ({ [side]: !state[side] }));

/** Ctrl/⌘ + \: hide both panels, or show both when any is hidden (focus on the canvas). */
export const toggleBothPanels = (): void =>
  usePanelsStore.setState((state) => {
    const show = !(state.left && state.right);
    return { left: show, right: show };
  });
