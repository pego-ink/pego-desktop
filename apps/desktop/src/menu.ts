import { type BaseWindow, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { MENU_COMMAND_CHANNEL, type MenuCommand } from "@/menu-channels";

/**
 * Minimal native menu. Edit roles make copy/paste work in text inputs. File and zoom shortcuts
 * are handled by the web app (keydown), so there is deliberately no File or zoom menu here.
 *
 * Close Tab replaces the window menu's Cmd+W "close" role so the shortcut reaches the page.
 * Select All is not the native role: a menu accelerator fires even when the page calls
 * preventDefault, and the role would select every piece of UI text. The page decides instead
 * (text in a focused input, otherwise the canvas nodes).
 */
const sendCommand = (window: BaseWindow | undefined, command: MenuCommand): void => {
  if (window instanceof BrowserWindow && !window.isDestroyed()) {
    window.webContents.send(MENU_COMMAND_CHANNEL, command);
  }
};

/**
 * `pageOwnsCloseTab`: the window has no menu bar (Linux / Windows "pego" title bar), where menu
 * accelerators are not dependable, so Close Tab only shows Ctrl+W and the page handles the key.
 */
export const installMenu = (isDev: boolean, pageOwnsCloseTab = false): void => {
  const template: MenuItemConstructorOptions[] = [
    // The app menu (About, Quit) is macOS only; elsewhere Quit lives in a File menu.
    process.platform === "darwin" ? { role: "appMenu" } : { role: "fileMenu" },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: (_item, window) => sendCommand(window, "select-all"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? ([{ role: "reload" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[])
          : []),
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        // Cmd+W closes the current tab in the page, never the window (Cmd+Shift+W does).
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          ...(pageOwnsCloseTab ? { registerAccelerator: false } : {}),
          click: (_item, window) => sendCommand(window, "close-tab"),
        },
        { label: "Close Window", accelerator: "CmdOrCtrl+Shift+W", role: "close" },
        ...(process.platform === "darwin"
          ? ([{ type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
