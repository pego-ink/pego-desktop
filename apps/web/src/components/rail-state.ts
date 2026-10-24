import { desktopApi } from "@/desktop/desktop-api";

/** "browser" exists only in the desktop app (see `railTabsFor`). */
export type RailTab = "agent" | "layers" | "assets" | "browser";

export type RailState = { tab: RailTab; open: boolean };

export const RAIL_STORAGE_KEY = "pego:left-rail";

export const DEFAULT_RAIL_STATE: RailState = { tab: "agent", open: true };

/** Every tab, top to bottom. Alt+1..4 follow the order of the tabs a window offers. */
export const RAIL_TABS: readonly { id: RailTab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "layers", label: "Layers" },
  { id: "assets", label: "Assets" },
  { id: "browser", label: "Browser" },
];

export type RailTabItem = (typeof RAIL_TABS)[number];

/** The tabs a window offers: "browser" only where the desktop app provides the native view. */
export const railTabsFor = (hasBrowser: boolean): readonly RailTabItem[] =>
  hasBrowser ? RAIL_TABS : RAIL_TABS.filter((tab) => tab.id !== "browser");

/** The desktop shell exposes the in-app browser view. */
export const hasDesktopBrowser = (): boolean => desktopApi()?.browser !== undefined;

const isRailTab = (value: unknown, tabs: readonly RailTabItem[]): value is RailTab =>
  tabs.some((tab) => tab.id === value);

/** Parses the persisted rail state; anything malformed or not offered here falls back. */
export const parseRailState = (
  raw: string | null,
  tabs: readonly RailTabItem[] = railTabsFor(false),
): RailState => {
  if (!raw) return DEFAULT_RAIL_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_RAIL_STATE;
    const { tab, open } = value as Record<string, unknown>;
    return {
      tab: isRailTab(tab, tabs) ? tab : DEFAULT_RAIL_STATE.tab,
      open: typeof open === "boolean" ? open : DEFAULT_RAIL_STATE.open,
    };
  } catch {
    return DEFAULT_RAIL_STATE;
  }
};

/** Clicking the active tab of an open panel collapses it; any other click opens that tab. */
export const pressTab = (state: RailState, tab: RailTab): RailState =>
  state.open && state.tab === tab ? { tab, open: false } : { tab, open: true };

/** Roving-focus target for a vertical tablist (wraps around). */
export const moveRailFocus = (current: number, key: string, count: number): number | null => {
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
};

/** Alt+1.. (no other modifiers) map to the offered tab at that position. */
export const railTabForShortcut = (
  e: Pick<KeyboardEvent, "code" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">,
  tabs: readonly RailTabItem[] = railTabsFor(false),
): RailTab | null => {
  if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return null;
  const match = /^Digit([1-9])$/.exec(e.code);
  return match ? (tabs[Number(match[1]) - 1]?.id ?? null) : null;
};

export const readRailState = (): RailState => {
  try {
    return parseRailState(localStorage.getItem(RAIL_STORAGE_KEY), railTabsFor(hasDesktopBrowser()));
  } catch {
    return DEFAULT_RAIL_STATE;
  }
};

export const writeRailState = (state: RailState) => {
  try {
    localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: the rail simply is not persisted
  }
};

/** Where the Browser panel opens: in the left side panel, or as its own column on the right. */
export type BrowserSide = "left" | "right";

/** The rail's state plus the right-hand Browser column (open only with the browser on the right). */
export type PanelsState = { rail: RailState; browserOpen: boolean };

/**
 * A rail icon was pressed. With the browser on the right, its icon opens and closes that column
 * and leaves the side panel alone; every other press works as usual.
 */
export const pressPanel = (state: PanelsState, side: BrowserSide, tab: RailTab): PanelsState =>
  side === "right" && tab === "browser"
    ? { ...state, browserOpen: !state.browserOpen }
    : { ...state, rail: pressTab(state.rail, tab) };

/** Show a tab's panel (never closes it): the right-hand column for the browser on the right. */
export const openPanel = (state: PanelsState, side: BrowserSide, tab: RailTab): PanelsState =>
  side === "right" && tab === "browser"
    ? { ...state, browserOpen: true }
    : { ...state, rail: { tab, open: true } };

/**
 * Move the browser to `side`, keeping it open or closed: to the right, a side panel showing it
 * switches back to the agent and the column takes over; to the left, an open column becomes the
 * side panel's tab.
 */
export const moveBrowser = (state: PanelsState, side: BrowserSide): PanelsState => {
  if (side === "right") {
    return state.rail.tab === "browser"
      ? { rail: { tab: "agent", open: state.rail.open }, browserOpen: state.rail.open }
      : state;
  }
  return state.browserOpen ? { rail: { tab: "browser", open: true }, browserOpen: false } : state;
};
