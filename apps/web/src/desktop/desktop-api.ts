/** Auto-update state reported by the desktop app (electron-updater). */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "not-available"; checkedAt: number }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string; releaseNotes?: string }
  | { state: "error"; message: string };

/**
 * What the Electron preload exposes as `window.pegoDesktop`. Undefined in a plain browser,
 * where update UI is hidden.
 */
export type PegoDesktopApi = {
  platform: string;
  /** App version, e.g. "0.0.1-beta". */
  version: string;
  checkForUpdates: () => Promise<void>;
  /** Quit and install a downloaded update. */
  installUpdate: () => void;
  /** Subscribe to update status changes; returns an unsubscribe function. */
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
  /** Native menu commands the page handles itself (absent in older shells). */
  onMenuCommand?: (listener: (command: DesktopMenuCommand) => void) => () => void;
  /**
   * Subscribe to full screen changes (replays the current state); returns an unsubscribe
   * function. Missing in desktop builds that still draw the native title bar.
   */
  onFullScreenChange?: (listener: (fullScreen: boolean) => void) => () => void;
  /** Point the native theme (traffic lights, dialogs, menus) at the editor's theme mode. */
  setThemeSource?: (mode: "light" | "dark" | "system") => void;
  /** The in-app browser view (absent in older shells and in a plain browser). */
  browser?: DesktopBrowserApi;
};

/** A rectangle in the editor window, CSS px from the top-left of the page viewport. */
export type DesktopBrowserBounds = { x: number; y: number; width: number; height: number };

/** Device emulation for the browser view: CSS px layout size, emulated screen, drawn scale. */
export type DesktopBrowserEmulation = {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  scale: number;
  mobile: boolean;
};

/** State of the in-app browser view; pushed on every change (replayed on subscribe). */
export type DesktopBrowserState = {
  /** "" before the first load. */
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The view is attached and painted (shown with bounds, not hidden). */
  visible: boolean;
  /** The last load failed: a user-readable reason, cleared by the next successful load. */
  error?: string;
};

/**
 * One native view (Electron WebContentsView, own session partition) drawn over the browser
 * panel. Created lazily by the first call; it keeps its page while hidden.
 */
export type DesktopBrowserApi = {
  /** Show the view at `bounds` (also used to move/resize it). Zero-size bounds hide it. */
  show: (bounds: DesktopBrowserBounds) => void;
  hide: () => void;
  /**
   * Load an http(s) or file URL; a bare host ("example.com") gets https. Resolves when the load
   * finishes, rejects with a user-readable Error when it fails or the URL is refused.
   */
  navigate: (
    url: string,
    /** file: URLs load only with `allowFile` (the panel's address bar; never the agent). */
    options?: { allowFile?: boolean },
  ) => Promise<{ url: string; title: string }>;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  /**
   * Send one Chrome DevTools Protocol command (via webContents.debugger) and resolve with its
   * result. Only the DOM, Input, Page, Runtime, Emulation, CSS and Accessibility domains pass.
   */
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /**
   * Emulate a device (native `enableDeviceEmulation`, the view keeps its size): the page lays
   * out at width x height CSS px and is drawn at `scale` inside the view. null = off. Optional:
   * older shells lack it.
   */
  setEmulation?: (emulation: DesktopBrowserEmulation | null) => void;
  /**
   * Download an http(s) image with the browser view's session (cookies, no CORS) for import.
   * Resolves with a data: URL of the original bytes (any image/* type, at most 8 MB); rejects
   * for other URLs, non-image responses and bigger files.
   */
  fetchImage?: (url: string) => Promise<string>;
  onState: (listener: (state: DesktopBrowserState) => void) => () => void;
  /**
   * Messages the page's injected scripts send with `console.debug("__pego__:" + JSON)`, parsed
   * (e.g. the element picker's `{ type: "picked" }`). Returns an unsubscribe function.
   */
  onPageMessage: (listener: (message: unknown) => void) => () => void;
};

export type DesktopMenuCommand = "select-all" | "close-tab";

export const desktopApi = (): PegoDesktopApi | undefined => {
  const api = (globalThis as { pegoDesktop?: Partial<PegoDesktopApi> }).pegoDesktop;
  return api && typeof api.checkForUpdates === "function" ? (api as PegoDesktopApi) : undefined;
};
