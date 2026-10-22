/** "browser" exists only in the desktop app (see `railTabsFor`). */
export type RailTab = "agent" | "layers" | "assets" | "browser";

export type RailState = { tab: RailTab; open: boolean };

export const RAIL_STORAGE_KEY = "pego:left-rail";

export const DEFAULT_RAIL_STATE: RailState = { tab: "agent", open: true };

/** Tab order, top to bottom. Alt+1 / Alt+2 / Alt+3 follow it. */
export const RAIL_TABS: readonly { id: RailTab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "layers", label: "Layers" },
  { id: "assets", label: "Assets" },
  { id: "browser", label: "Browser" },
];

const isRailTab = (value: unknown): value is RailTab => RAIL_TABS.some((tab) => tab.id === value);

/** Parses the persisted rail state; anything malformed falls back to the default. */
export const parseRailState = (raw: string | null): RailState => {
  if (!raw) return DEFAULT_RAIL_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_RAIL_STATE;
    const { tab, open } = value as Record<string, unknown>;
    return {
      tab: isRailTab(tab) ? tab : DEFAULT_RAIL_STATE.tab,
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

/** Alt+1 / Alt+2 / Alt+3 (no other modifiers) map to the tab at that position. */
export const railTabForShortcut = (
  e: Pick<KeyboardEvent, "code" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">,
): RailTab | null => {
  if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return null;
  const match = /^Digit([1-9])$/.exec(e.code);
  return match ? (RAIL_TABS[Number(match[1]) - 1]?.id ?? null) : null;
};

export const readRailState = (): RailState => {
  try {
    return parseRailState(localStorage.getItem(RAIL_STORAGE_KEY));
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
