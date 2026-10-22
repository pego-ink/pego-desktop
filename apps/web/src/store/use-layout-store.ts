import { create } from "zustand";

const PIN_KEY = "pego:properties-pinned";

const readPinned = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
};

type LayoutState = {
  /** Keep the Properties panel open even when nothing is selected. */
  propertiesPinned: boolean;
  togglePropertiesPinned: () => void;
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  propertiesPinned: readPinned(),
  togglePropertiesPinned: () => {
    const propertiesPinned = !get().propertiesPinned;
    set({ propertiesPinned });
    try {
      globalThis.localStorage?.setItem(PIN_KEY, propertiesPinned ? "1" : "0");
    } catch {
      // Best effort: the choice just won't survive a reload.
    }
  },
}));

/** The Properties panel shows while something is selected, or always when pinned. */
export const showProperties = (selectionCount: number, pinned: boolean): boolean =>
  pinned || selectionCount > 0;
