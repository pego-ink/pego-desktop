import { create } from "zustand";
import {
  moveBrowser,
  openPanel,
  pressPanel,
  readRailState,
  writeRailState,
  type BrowserSide,
  type PanelsState,
  type RailState,
  type RailTab,
} from "@/components/rail-state";
import { useSettingsStore } from "@/store/use-settings-store";

const PIN_KEY = "pego:properties-pinned";
const RIGHT_KEY = "pego:properties-hidden";
const BROWSER_KEY = "pego:browser-column-open";

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
 * is open. Right: the properties column, which the user can hide outright or pin open, and the
 * Browser column when the browser sits on the right (Settings > General > Browser panel).
 */
type LayoutState = {
  rail: RailState;
  /** The right-hand Browser column is open (only used with the browser on the right). */
  browserOpen: boolean;
  /** Keep the Properties panel open even when nothing is selected. */
  propertiesPinned: boolean;
  /** The user hid the right column (it stays hidden whatever is selected). */
  rightHidden: boolean;
  pressRailTab: (tab: RailTab) => void;
  /** Show this tab's panel (never collapses it, unlike `pressRailTab`). */
  openRailTab: (tab: RailTab) => void;
  togglePropertiesPinned: () => void;
  toggleRight: () => void;
  /** Ctrl/⌘ + \: hide both side panels, or show both when any is hidden. */
  toggleBothPanels: () => void;
  /** Move the Browser panel to the left side panel or its own right column (saved setting). */
  setBrowserSide: (side: BrowserSide) => void;
};

const browserSide = (): BrowserSide => useSettingsStore.getState().browserSide;

export const useLayoutStore = create<LayoutState>((set, get) => {
  /** Apply and remember a new rail / Browser column state. */
  const setPanels = (next: PanelsState) => {
    writeRailState(next.rail);
    writeFlag(BROWSER_KEY, next.browserOpen);
    set(next);
  };
  const panels = (): PanelsState => ({ rail: get().rail, browserOpen: get().browserOpen });
  return {
    // Saved separately from the side: a side panel left on the Browser tab while the browser is
    // on the right hands it to the column, like moving it does.
    ...moveBrowser({ rail: readRailState(), browserOpen: readFlag(BROWSER_KEY) }, browserSide()),
    propertiesPinned: readFlag(PIN_KEY),
    rightHidden: readFlag(RIGHT_KEY),
    pressRailTab: (tab) => setPanels(pressPanel(panels(), browserSide(), tab)),
    openRailTab: (tab) => setPanels(openPanel(panels(), browserSide(), tab)),
    setBrowserSide: (side) => {
      useSettingsStore.getState().update({ browserSide: side });
      setPanels(moveBrowser(panels(), side));
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
      // Hiding both sides also closes the Browser column; showing them leaves it as it is.
      if (!show) writeFlag(BROWSER_KEY, false);
      set({ rail: next, rightHidden: !show, ...(show ? {} : { browserOpen: false }) });
    },
  };
});

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
