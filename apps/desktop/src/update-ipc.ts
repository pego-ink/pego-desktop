import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { createUpdater, type UpdateController } from "@/updater";
import {
  isTrustedSender,
  isUpdateStatus,
  UPDATE_CHANNELS,
  type UpdateStatus,
} from "@/update-status";

/** Registers the narrow update IPC surface. Every handler checks the sender's origin. */
export const registerUpdateIpc = async (
  appOrigin: string,
  getWindow: () => BrowserWindow | null,
): Promise<void> => {
  const publish = (status: UpdateStatus): void => {
    if (!isUpdateStatus(status)) return;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(UPDATE_CHANNELS.status, status);
  };
  const controller: UpdateController = await createUpdater(publish);

  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    isTrustedSender(event.senderFrame?.url, appOrigin);

  ipcMain.handle(UPDATE_CHANNELS.getStatus, (event): UpdateStatus => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return controller.getStatus();
  });
  ipcMain.handle(UPDATE_CHANNELS.check, async (event): Promise<void> => {
    if (!trusted(event)) throw new Error("untrusted sender");
    await controller.check();
  });
  ipcMain.on(UPDATE_CHANNELS.install, (event) => {
    if (!trusted(event)) return;
    controller.install();
  });
};
