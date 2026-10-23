import { create } from "zustand";
import { isToolbarPosition, type ToolbarPosition } from "@/components/toolbar-position";

/** Editor preferences, persisted per browser/app install. */
export type EditorSettings = {
  /** Arrow-key nudge in px, and with Shift. */
  nudgeSmall: number;
  nudgeLarge: number;
  /** Mouse wheel without modifiers: pan the canvas (trackpad-like) or zoom. */
  wheelBehavior: "pan" | "zoom";
  /** Round positions and sizes to whole pixels while moving/resizing/drawing. */
  snapToPixel: boolean;
  /** Where the floating tool picker sits on the canvas. */
  toolbarPosition: ToolbarPosition;
};

export const DEFAULT_SETTINGS: EditorSettings = {
  nudgeSmall: 1,
  nudgeLarge: 10,
  wheelBehavior: "pan",
  snapToPixel: true,
  toolbarPosition: "bottom",
};

const KEY = "pego:settings.v1";

const isStep = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1000;

/** Merge a stored/partial value over the defaults, dropping anything invalid. */
export const mergeSettings = (raw: unknown): EditorSettings => {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SETTINGS;
  const v = raw as Partial<Record<keyof EditorSettings, unknown>>;
  return {
    nudgeSmall: isStep(v.nudgeSmall) ? v.nudgeSmall : DEFAULT_SETTINGS.nudgeSmall,
    nudgeLarge: isStep(v.nudgeLarge) ? v.nudgeLarge : DEFAULT_SETTINGS.nudgeLarge,
    wheelBehavior:
      v.wheelBehavior === "pan" || v.wheelBehavior === "zoom"
        ? v.wheelBehavior
        : DEFAULT_SETTINGS.wheelBehavior,
    snapToPixel: typeof v.snapToPixel === "boolean" ? v.snapToPixel : DEFAULT_SETTINGS.snapToPixel,
    toolbarPosition: isToolbarPosition(v.toolbarPosition)
      ? v.toolbarPosition
      : DEFAULT_SETTINGS.toolbarPosition,
  };
};

const load = (): EditorSettings => {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? mergeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
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
