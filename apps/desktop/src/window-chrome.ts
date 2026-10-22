import type { BrowserWindowConstructorOptions } from "electron";

/** IPC channel allowlist for window chrome state, shared by main and preload. */
export const WINDOW_CHANNELS = {
  getFullScreen: "pego:window:get-full-screen",
  fullScreen: "pego:window:full-screen",
  themeSource: "pego:window:theme-source",
} as const;

/** The editor's theme modes; each maps straight onto `nativeTheme.themeSource`. */
export type ThemeSource = "light" | "dark" | "system";

export const isThemeSource = (value: unknown): value is ThemeSource =>
  value === "light" || value === "dark" || value === "system";

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "trafficLightPosition"
>;

/**
 * macOS: no title bar, the editor draws up to the top edge and the traffic lights sit centred in
 * its 44px top row (`h-11`). Other platforms keep the native frame.
 */
export const windowChromeOptions = (platform: NodeJS.Platform): WindowChromeOptions =>
  platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 15 } } : {};
