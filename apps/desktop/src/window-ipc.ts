import { BrowserWindow, ipcMain } from "electron";
import { isTrustedSender } from "@/update-status";
import { WINDOW_CHANNELS } from "@/window-chrome";

/** Answers the editor's full screen query; only the app's own origin may ask. */
export const registerWindowIpc = (appOrigin: string): void => {
  ipcMain.handle(WINDOW_CHANNELS.getFullScreen, (event): boolean => {
    if (!isTrustedSender(event.senderFrame?.url, appOrigin)) throw new Error("untrusted sender");
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });
};

/** macOS hides the traffic lights in full screen; tell the editor so it drops their gutter. */
export const forwardFullScreen = (win: BrowserWindow): void => {
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(WINDOW_CHANNELS.fullScreen, win.isFullScreen());
  };
  win.on("enter-full-screen", send);
  win.on("leave-full-screen", send);
};
