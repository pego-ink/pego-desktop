import { create } from "zustand";

/** Editor preferences, persisted per browser/app install. */
export type EditorSettings = {
  /** Arrow-key nudge in px, and with Shift. */
  nudgeSmall: number;
  nudgeLarge: number;
  /** Mouse wheel without modifiers: pan the canvas (trackpad-like) or zoom. */
  wheelBehavior: "pan" | "zoom";
  /** Round positions and sizes to whole pixels while moving/resizing/drawing. */
  snapToPixel: boolean;
};

export const DEFAULT_SETTINGS: EditorSettings = {
  nudgeSmall: 1,
  nudgeLarge: 10,
  wheelBehavior: "pan",
  snapToPixel: true,
};

const KEY = "pego:settings.v1";

const load = (): EditorSettings => {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<EditorSettings>) }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

type SettingsState = EditorSettings & {
  update: (patch: Partial<EditorSettings>) => void;
  reset: () => void;
};

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persist = () => {
    try {
      const { update: _u, reset: _r, ...settings } = get();
      void _u;
      void _r;
      globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Best effort.
    }
  };
  return {
    ...load(),
    update: (patch) => {
      set(patch);
      persist();
    },
    reset: () => {
      set(DEFAULT_SETTINGS);
      persist();
    },
  };
});

export type SettingsTab = "general" | "agent" | "shortcuts" | "about";

type SettingsModalState = {
  open: boolean;
  tab: SettingsTab;
  /** Optional section to scroll to inside the tab (e.g. "custom-providers", "add-provider"). */
  section?: string;
  openSettings: (tab?: SettingsTab, section?: string) => void;
  close: () => void;
};

/** One settings modal for everything (⌘, , the rail gear, "Model settings…"). */
export const useSettingsModal = create<SettingsModalState>((set) => ({
  open: false,
  tab: "general",
  openSettings: (tab = "general", section) => set({ open: true, tab, section }),
  close: () => set({ open: false, section: undefined }),
}));
