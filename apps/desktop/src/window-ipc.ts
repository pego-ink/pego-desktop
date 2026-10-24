import { BrowserWindow, ipcMain, Menu, nativeTheme } from "electron";
import { isTrustedSender } from "@/update-status";
import {
  isThemeSource,
  isTitleBarMode,
  parseMenuPoint,
  parseTitleBarOverlay,
  WINDOW_CHANNELS,
} from "@/window-chrome";
import { writeTitleBarMode } from "@/window-prefs";

/**
 * Answers the editor's full screen query and follows its theme mode, so the traffic lights,
 * dialogs and menus match the editor; on Linux and Windows also colors the window controls,
 * opens the menu from the editor's button and saves the title bar choice. Only the app's own
 * origin may use any of it.
 */
export const registerWindowIpc = (appOrigin: string, prefsFile: string): void => {
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    isTrustedSender(event.senderFrame?.url, appOrigin);

  ipcMain.handle(WINDOW_CHANNELS.getFullScreen, (event): boolean => {
    if (!trusted(event)) throw new Error("untrusted sender");
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });
  ipcMain.on(WINDOW_CHANNELS.themeSource, (event, mode: unknown) => {
    if (!trusted(event) || !isThemeSource(mode)) return;
    nativeTheme.themeSource = mode;
  });
  ipcMain.on(WINDOW_CHANNELS.titleBarOverlay, (event, value: unknown) => {
    const overlay = parseTitleBarOverlay(value);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!trusted(event) || !overlay || !win) return;
    try {
      win.setTitleBarOverlay(overlay);
    } catch {
      // A window created with the system title bar has no overlay to color.
    }
  });
  ipcMain.on(WINDOW_CHANNELS.popupMenu, (event, value: unknown) => {
    const point = parseMenuPoint(value);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!trusted(event) || !point || !win) return;
    Menu.getApplicationMenu()?.popup({ window: win, ...point });
  });
  ipcMain.handle(WINDOW_CHANNELS.setTitleBar, (event, mode: unknown): boolean => {
    if (!trusted(event)) throw new Error("untrusted sender");
    if (!isTitleBarMode(mode)) return false;
    writeTitleBarMode(prefsFile, mode);
    return true;
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
