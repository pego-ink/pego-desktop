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

/**
 * The right column shows while something is selected, when pinned, or while the Frame tool is
 * active (it then holds the frame size presets).
 */
export const showProperties = (
  selectionCount: number,
  pinned: boolean,
  frameToolActive = false,
): boolean => pinned || selectionCount > 0 || frameToolActive;
