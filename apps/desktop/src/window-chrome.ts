import type { BrowserWindowConstructorOptions } from "electron";

/** IPC channel allowlist for window chrome state, shared by main and preload. */
export const WINDOW_CHANNELS = {
  getFullScreen: "pego:window:get-full-screen",
  fullScreen: "pego:window:full-screen",
  themeSource: "pego:window:theme-source",
  titleBarOverlay: "pego:window:title-bar-overlay",
  popupMenu: "pego:window:popup-menu",
  setTitleBar: "pego:window:set-title-bar",
} as const;

/** The editor's theme modes; each maps straight onto `nativeTheme.themeSource`. */
export type ThemeSource = "light" | "dark" | "system";

export const isThemeSource = (value: unknown): value is ThemeSource =>
  value === "light" || value === "dark" || value === "system";

/**
 * Linux and Windows: "pego" draws the window controls over the editor's tab row (one bar, menu
 * behind a button), "system" keeps the window manager's title bar and menu bar.
 */
export type TitleBarMode = "pego" | "system";

export const isTitleBarMode = (value: unknown): value is TitleBarMode =>
  value === "pego" || value === "system";

/** The title bar mode passed to the preload through `additionalArguments`. */
export const TITLE_BAR_ARG = "--pego-title-bar=";

/** The mode the window was created with; null on macOS (always its own title bar). */
export const parseTitleBarArg = (argv: readonly string[]): TitleBarMode | null => {
  const raw = argv.find((arg) => arg.startsWith(TITLE_BAR_ARG))?.slice(TITLE_BAR_ARG.length);
  return isTitleBarMode(raw) ? raw : null;
};

export type TitleBarOverlay = { color: string; symbolColor: string; height: number };

/** Until the editor sends its own colors: the dark window background, light symbols. */
const DEFAULT_OVERLAY: TitleBarOverlay = { color: "#141418", symbolColor: "#e4e4e7", height: 40 };

const HEX = /^#[0-9a-f]{6}$/i;

/** The overlay colors and height the editor asks for, or null when they are not valid. */
export const parseTitleBarOverlay = (value: unknown): TitleBarOverlay | null => {
  if (typeof value !== "object" || value === null) return null;
  const { color, symbolColor, height } = value as Record<string, unknown>;
  if (typeof color !== "string" || !HEX.test(color)) return null;
  if (typeof symbolColor !== "string" || !HEX.test(symbolColor)) return null;
  if (typeof height !== "number" || !Number.isInteger(height) || height < 28 || height > 64) {
    return null;
  }
  return { color, symbolColor, height };
};

/** Where to open the menu (CSS px in the window), or null. */
export const parseMenuPoint = (value: unknown): { x: number; y: number } | null => {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  const ok = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 20_000;
  return ok(x) && ok(y) ? { x: Math.round(x), y: Math.round(y) } : null;
};

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "trafficLightPosition" | "titleBarOverlay"
>;

/**
 * macOS: no title bar, the editor draws up to the top edge and the traffic lights sit centred in
 * its 44px top row (`h-11`). Linux and Windows with the "pego" title bar: no title bar either,
 * the window controls are drawn over the right end of the tab row (Window Controls Overlay).
 * With "system" they keep the native frame.
 */
export const windowChromeOptions = (
  platform: NodeJS.Platform,
  titleBar: TitleBarMode = "pego",
): WindowChromeOptions => {
  if (platform === "darwin") {
    return { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 15 } };
  }
  if ((platform === "linux" || platform === "win32") && titleBar === "pego") {
    return { titleBarStyle: "hidden", titleBarOverlay: { ...DEFAULT_OVERLAY } };
  }
  return {};
};
