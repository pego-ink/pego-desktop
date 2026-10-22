import { create } from "zustand";

export type LeftTab = "layers" | "assets" | "agent";

/** Which side panels are shown and the left panel's tab. Remembered per browser. */
type PanelsState = { left: boolean; right: boolean; leftTab: LeftTab };

const LEFT_TABS: readonly LeftTab[] = ["layers", "assets", "agent"];

const STORAGE_KEY = "pego.panels";

const read = (): PanelsState => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<PanelsState>;
    return {
      left: stored.left !== false,
      right: stored.right !== false,
      leftTab: LEFT_TABS.includes(stored.leftTab as LeftTab)
        ? (stored.leftTab as LeftTab)
        : "layers",
    };
  } catch {
    return { left: true, right: true, leftTab: "layers" };
  }
};

export const usePanelsStore = create<PanelsState>(() =>
  typeof localStorage === "undefined" ? { left: true, right: true, leftTab: "layers" } : read(),
);

usePanelsStore.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the choice lasts for this session.
  }
});

export const setLeftTab = (leftTab: LeftTab): void => usePanelsStore.setState({ leftTab });

/** Show the agent panel (the left panel on its Agent tab), e.g. after a canvas prompt. */
export const showAgentPanel = (): void => usePanelsStore.setState({ left: true, leftTab: "agent" });

export const togglePanel = (side: "left" | "right"): void =>
  usePanelsStore.setState((state) => ({ [side]: !state[side] }));

/** Ctrl/⌘ + \: hide both panels, or show both when any is hidden (focus on the canvas). */
export const toggleBothPanels = (): void =>
  usePanelsStore.setState((state) => {
    const show = !(state.left && state.right);
    return { left: show, right: show };
  });
