import { contextBridge, ipcRenderer } from "electron";
import {
  isUpdateStatus,
  parseVersionArg,
  UPDATE_CHANNELS,
  type UpdateStatus,
} from "@/update-status";
import { isMenuCommand, MENU_COMMAND_CHANNEL, type MenuCommand } from "@/menu-channels";
import { WINDOW_CHANNELS } from "@/window-chrome";
import { BROWSER_CHANNELS } from "@/browser-channels";

/**
 * Sandboxed preload. Exposes the `PegoDesktopApi` contract (apps/web/src/desktop/desktop-api.ts)
 * over a fixed channel allowlist; incoming statuses are validated before reaching the page.
 */
const version = parseVersionArg(process.argv);

const onUpdateStatus = (listener: (status: UpdateStatus) => void): (() => void) => {
  if (typeof listener !== "function") return () => {};
  let active = true;
  const handler = (_event: unknown, payload: unknown): void => {
    if (active && isUpdateStatus(payload)) listener(payload);
  };
  ipcRenderer.on(UPDATE_CHANNELS.status, handler);
  // Replay the current status so late subscribers do not miss it.
  void ipcRenderer.invoke(UPDATE_CHANNELS.getStatus).then(
    (payload: unknown) => {
      if (active && isUpdateStatus(payload)) listener(payload);
    },
    () => {},
  );
  return () => {
    active = false;
    ipcRenderer.removeListener(UPDATE_CHANNELS.status, handler);
  };
};

const onMenuCommand = (listener: (command: MenuCommand) => void): (() => void) => {
  if (typeof listener !== "function") return () => {};
  const handler = (_event: unknown, payload: unknown): void => {
    if (isMenuCommand(payload)) listener(payload);
  };
  ipcRenderer.on(MENU_COMMAND_CHANNEL, handler);
  return () => {
    ipcRenderer.removeListener(MENU_COMMAND_CHANNEL, handler);
  };
};

const onFullScreenChange = (listener: (fullScreen: boolean) => void): (() => void) => {
  if (typeof listener !== "function") return () => {};
  let active = true;
  const handler = (_event: unknown, payload: unknown): void => {
    if (active && typeof payload === "boolean") listener(payload);
  };
  ipcRenderer.on(WINDOW_CHANNELS.fullScreen, handler);
  // Replay the current state: the window may already be in full screen.
  void ipcRenderer.invoke(WINDOW_CHANNELS.getFullScreen).then(
    (payload: unknown) => {
      if (active && typeof payload === "boolean") listener(payload);
    },
    () => {},
  );
  return () => {
    active = false;
    ipcRenderer.removeListener(WINDOW_CHANNELS.fullScreen, handler);
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isBrowserState = (value: unknown): boolean =>
  isRecord(value) && typeof value.url === "string" && typeof value.loading === "boolean";

const subscribe = (
  channel: string,
  accept: (payload: unknown) => boolean,
  listener: (payload: never) => void,
  replay?: string,
): (() => void) => {
  if (typeof listener !== "function") return () => {};
  let active = true;
  const deliver = (payload: unknown): void => {
    if (active && accept(payload)) (listener as (payload: unknown) => void)(payload);
  };
  const handler = (_event: unknown, payload: unknown): void => deliver(payload);
  ipcRenderer.on(channel, handler);
  if (replay) void ipcRenderer.invoke(replay).then(deliver, () => {});
  return () => {
    active = false;
    ipcRenderer.removeListener(channel, handler);
  };
};

const browser = {
  show: (bounds: unknown): void => ipcRenderer.send(BROWSER_CHANNELS.show, bounds),
  hide: (): void => ipcRenderer.send(BROWSER_CHANNELS.hide),
  navigate: (url: unknown, options?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(BROWSER_CHANNELS.navigate, url, options),
  back: (): void => ipcRenderer.send(BROWSER_CHANNELS.back),
  forward: (): void => ipcRenderer.send(BROWSER_CHANNELS.forward),
  reload: (): void => ipcRenderer.send(BROWSER_CHANNELS.reload),
  stop: (): void => ipcRenderer.send(BROWSER_CHANNELS.stop),
  setEmulation: (emulation: unknown): void =>
    ipcRenderer.send(BROWSER_CHANNELS.setEmulation, emulation),
  cdp: (method: unknown, params?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(BROWSER_CHANNELS.cdp, method, params),
  // Replay the current state so a late subscriber sees the view as it is.
  onState: (listener: (state: never) => void): (() => void) =>
    subscribe(BROWSER_CHANNELS.state, isBrowserState, listener, BROWSER_CHANNELS.getState),
  onPageMessage: (listener: (message: never) => void): (() => void) =>
    subscribe(BROWSER_CHANNELS.pageMessage, () => true, listener),
};

contextBridge.exposeInMainWorld("pegoDesktop", {
  platform: process.platform,
  version,
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(UPDATE_CHANNELS.check),
  installUpdate: (): void => ipcRenderer.send(UPDATE_CHANNELS.install),
  onUpdateStatus,
  onMenuCommand,
  onFullScreenChange,
  setThemeSource: (mode: unknown): void => ipcRenderer.send(WINDOW_CHANNELS.themeSource, mode),
  browser,
});
