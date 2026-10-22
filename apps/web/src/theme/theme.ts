import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "pego.theme";
const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

/** Canvas backdrop per theme (the area around frames); a step below the panels. */
export const CANVAS_BACKGROUND: Record<ResolvedTheme, string> = {
  dark: "#141418",
  light: "#E9E9EE",
};

const systemPrefersLight = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: light)").matches;

export const resolveTheme = (mode: ThemeMode, prefersLight: boolean): ResolvedTheme =>
  mode === "system" ? (prefersLight ? "light" : "dark") : mode;

const readMode = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : "system";
  } catch {
    return "system";
  }
};

const applyClass = (theme: ResolvedTheme) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
};

type ThemeState = { mode: ThemeMode; resolved: ResolvedTheme };

const initialMode = typeof localStorage === "undefined" ? "system" : readMode();
export const useThemeStore = create<ThemeState>(() => ({
  mode: initialMode,
  resolved: resolveTheme(initialMode, systemPrefersLight()),
}));

export const setThemeMode = (mode: ThemeMode): void => {
  const resolved = resolveTheme(mode, systemPrefersLight());
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode: the choice lasts for this session only.
  }
  applyClass(resolved);
  useThemeStore.setState({ mode, resolved });
};

/** Light → dark → system → light. */
export const nextThemeMode = (mode: ThemeMode): ThemeMode =>
  MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;

/** Follow the system setting while in "system" mode. Returns a cleanup function. */
export const watchSystemTheme = (): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    const { mode } = useThemeStore.getState();
    if (mode !== "system") return;
    const resolved = resolveTheme(mode, query.matches);
    applyClass(resolved);
    useThemeStore.setState({ resolved });
  };
  applyClass(useThemeStore.getState().resolved);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
