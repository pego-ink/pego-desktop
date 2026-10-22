import { contextBridge, ipcRenderer } from "electron";
import {
  isUpdateStatus,
  parseVersionArg,
  UPDATE_CHANNELS,
  type UpdateStatus,
} from "@/update-status";
import { isMenuCommand, MENU_COMMAND_CHANNEL, type MenuCommand } from "@/menu-channels";

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

contextBridge.exposeInMainWorld("pegoDesktop", {
  platform: process.platform,
  version,
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(UPDATE_CHANNELS.check),
  installUpdate: (): void => ipcRenderer.send(UPDATE_CHANNELS.install),
  onUpdateStatus,
  onMenuCommand,
});
