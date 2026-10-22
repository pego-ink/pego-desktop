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
};

export const desktopApi = (): PegoDesktopApi | undefined => {
  const api = (globalThis as { pegoDesktop?: Partial<PegoDesktopApi> }).pegoDesktop;
  return api && typeof api.checkForUpdates === "function" ? (api as PegoDesktopApi) : undefined;
};
