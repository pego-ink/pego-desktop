import { create } from "zustand";

const KEY = "pego:frame-preset-open";
const DEFAULT_OPEN = ["phone", "social"];

const read = (): string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_OPEN;
};

type OpenState = {
  open: readonly string[];
  toggle: (id: string) => void;
};

/** Which preset categories are expanded; remembered across reloads. */
export const useOpenCategories = create<OpenState>((set, get) => ({
  open: read(),
  toggle: (id) => {
    const { open } = get();
    const next = open.includes(id) ? open.filter((x) => x !== id) : [...open, id];
    set({ open: next });
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
    } catch {
      // Best effort.
    }
  },
}));
