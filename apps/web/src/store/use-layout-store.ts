import { create } from "zustand";
import {
  pressTab,
  readRailState,
  writeRailState,
  type RailState,
  type RailTab,
} from "@/components/rail-state";

const PIN_KEY = "pego:properties-pinned";
const RIGHT_KEY = "pego:properties-hidden";

const readFlag = (key: string): boolean => {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
};

const writeFlag = (key: string, value: boolean) => {
  try {
    globalThis.localStorage?.setItem(key, value ? "1" : "0");
  } catch {
    // Best effort: the choice just won't survive a reload.
  }
};

/**
 * Editor layout, one store for both sides. Left: the icon rail's tab and whether its side panel
 * is open. Right: the properties column, which the user can hide outright or pin open.
 */
type LayoutState = {
  rail: RailState;
  /** Keep the Properties panel open even when nothing is selected. */
  propertiesPinned: boolean;
  /** The user hid the right column (it stays hidden whatever is selected). */
  rightHidden: boolean;
  pressRailTab: (tab: RailTab) => void;
  togglePropertiesPinned: () => void;
  toggleRight: () => void;
  /** Ctrl/⌘ + \: hide both side panels, or show both when any is hidden. */
  toggleBothPanels: () => void;
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  rail: readRailState(),
  propertiesPinned: readFlag(PIN_KEY),
  rightHidden: readFlag(RIGHT_KEY),
  pressRailTab: (tab) => {
    const rail = pressTab(get().rail, tab);
    writeRailState(rail);
    set({ rail });
  },
  togglePropertiesPinned: () => {
    const propertiesPinned = !get().propertiesPinned;
    writeFlag(PIN_KEY, propertiesPinned);
    set({ propertiesPinned });
  },
  toggleRight: () => {
    const rightHidden = !get().rightHidden;
    writeFlag(RIGHT_KEY, rightHidden);
    set({ rightHidden });
  },
  toggleBothPanels: () => {
    const { rail, rightHidden } = get();
    const show = !rail.open || rightHidden;
    const next = { ...rail, open: show };
    writeRailState(next);
    writeFlag(RIGHT_KEY, !show);
    set({ rail: next, rightHidden: !show });
  },
}));

/**
 * The right column shows while something is selected, when pinned, or while the Frame tool is
 * active (it then holds the frame size presets), unless the user hid it.
 */
export const showProperties = (
  selectionCount: number,
  pinned: boolean,
  frameToolActive = false,
  hidden = false,
): boolean => !hidden && (pinned || selectionCount > 0 || frameToolActive);
