import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { isUpdateChannel, type UpdateChannel } from "@/update-channel";
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
  ipcMain.handle(UPDATE_CHANNELS.getChannel, (event): UpdateChannel | null => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return controller.getChannel();
  });
  ipcMain.handle(
    UPDATE_CHANNELS.setChannel,
    async (event, channel: unknown): Promise<UpdateChannel | null> => {
      if (!trusted(event)) throw new Error("untrusted sender");
      if (!isUpdateChannel(channel)) throw new Error("unknown update channel");
      if (controller.getChannel() === null) throw new Error("this build does not update itself");
      await controller.setChannel(channel);
      return controller.getChannel();
    },
  );
  ipcMain.on(UPDATE_CHANNELS.install, (event) => {
    if (!trusted(event)) return;
    controller.install();
  });
};
