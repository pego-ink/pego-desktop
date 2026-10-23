import { create } from "zustand";
import type { DesktopBrowserState } from "@/desktop/desktop-api";
import { parseDeviceChoice, RESPONSIVE_CHOICE, type DeviceChoice } from "@/browser/device-presets";

const DEVICE_KEY = "pego:browser-device";

const readDevice = (): DeviceChoice => {
  try {
    return parseDeviceChoice(globalThis.localStorage?.getItem(DEVICE_KEY) ?? null);
  } catch {
    return RESPONSIVE_CHOICE;
  }
};

const writeDevice = (device: DeviceChoice) => {
  try {
    globalThis.localStorage?.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch {
    // Best effort.
  }
};

export const INITIAL_BROWSER_STATE: DesktopBrowserState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  visible: false,
};

/**
 * The in-app browser as the editor sees it. `state` mirrors the desktop view (fed by
 * `connectBrowser` in browser-session.ts); the panel renders it, the browser host waits on it.
 */
type BrowserStore = {
  state: DesktopBrowserState;
  /** The element picker is armed in the page (hover highlights, click picks). */
  picking: boolean;
  /** An element is picked (`target: "selection"` resolves to it); cleared on navigation. */
  hasPicked: boolean;
  /** Device preview (responsive = no emulation); remembered across reloads. */
  device: DeviceChoice;
  setState: (state: DesktopBrowserState) => void;
  setDevice: (device: DeviceChoice) => void;
  setPicking: (picking: boolean) => void;
  setHasPicked: (hasPicked: boolean) => void;
};

export const useBrowserStore = create<BrowserStore>((set) => ({
  state: INITIAL_BROWSER_STATE,
  picking: false,
  hasPicked: false,
  device: readDevice(),
  setState: (state) => set({ state }),
  setDevice: (device) => {
    writeDevice(device);
    set({ device });
  },
  setPicking: (picking) => set({ picking }),
  setHasPicked: (hasPicked) => set({ hasPicked }),
}));
