import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { APP_ORIGIN, APP_URL } from "@/constants";
import { startBridge, stopBridge } from "@/bridge";
import { registerBrowserIpc } from "@/browser-ipc";
import { installMenu } from "@/menu";
import { registerAppProtocol, registerAppScheme } from "@/protocol";
import { registerUpdateIpc } from "@/update-ipc";
import { VERSION_ARG } from "@/update-status";
import { TITLE_BAR_ARG, windowChromeOptions } from "@/window-chrome";
import { readTitleBarMode } from "@/window-prefs";
import { installAppImageEntry } from "@/linux-desktop-install";
import { forwardFullScreen, registerWindowIpc } from "@/window-ipc";

// Dev: `desktop:dev` points this at the Vite server. Anything else loads the built web app.
const devUrl = process.env.PEGO_DEV_URL;
const isDev = devUrl !== undefined;

/** `URL.origin` is "null" for custom schemes in Node, so compare scheme + host explicitly. */
const originOf = (url: URL): string => `${url.protocol}//${url.host}`;
const appOrigin = isDev ? originOf(new URL(devUrl)) : APP_ORIGIN;

registerAppScheme();

/** Packaged: web build shipped in Resources/web. Unpackaged (`electron .`): the workspace build. */
const webRoot = (): string =>
  app.isPackaged ? join(process.resourcesPath, "web") : join(app.getAppPath(), "..", "web", "dist");

let mainWindow: BrowserWindow | null = null;

const openExternalIfSafe = (url: string): void => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "mailto:") void shell.openExternal(url);
  } catch {
    // ignore malformed URLs
  }
};

/** The app icon file: in the packaged resources (Linux), else the build folder (dev). */
const linuxIconPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "build", "icon.png");

/** Window preferences that apply when a window is created (the title bar mode). */
const windowPrefsFile = (): string => join(app.getPath("userData"), "window-prefs.json");

const createWindow = (): void => {
  const titleBar = readTitleBarMode(windowPrefsFile());
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#141418",
    title: "Pego",
    // X11 docks read the window's icon; Wayland ones use the launcher entry (pego.desktop).
    ...(process.platform === "linux" ? { icon: linuxIconPath() } : {}),
    ...windowChromeOptions(process.platform, titleBar),
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      additionalArguments: [
        `${VERSION_ARG}${app.getVersion()}`,
        ...(process.platform === "darwin" ? [] : [`${TITLE_BAR_ARG}${titleBar}`]),
      ],
    },
  });
  mainWindow = win;
  forwardFullScreen(win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (originOf(new URL(url)) === appOrigin) return;
    event.preventDefault();
    openExternalIfSafe(url);
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  void win.loadURL(devUrl ?? APP_URL);
};

/** Origin of a permission request URL, or "" when it is missing or unparsable. */
const requestOrigin = (url: string | undefined): string => {
  if (!url) return "";
  try {
    return originOf(new URL(url));
  } catch {
    return "";
  }
};

const hardenSession = (): void => {
  // The only permission the editor needs is `fileSystem`: File System Access must be allowed to
  // read and write the .pego files the user picked (Save / Open / auto save). Everything else
  // (camera, mic, notifications, …) stays denied, and only the app's own origin is trusted.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permission === "fileSystem" && requestOrigin(details.requestingUrl) === appOrigin),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin) =>
      permission === "fileSystem" && requestOrigin(requestingOrigin) === appOrigin,
  );
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    app.setName("Pego");
    // An AppImage installs no launcher entry, so docks showed a generic icon: add Pego's own.
    if (process.platform === "linux") installAppImageEntry(linuxIconPath());
    hardenSession();
    installMenu(
      isDev,
      process.platform !== "darwin" && readTitleBarMode(windowPrefsFile()) === "pego",
    );
    if (!isDev) registerAppProtocol(webRoot());
    await startBridge();
    await registerUpdateIpc(appOrigin, () => mainWindow);
    registerWindowIpc(appOrigin, windowPrefsFile());
    registerBrowserIpc(appOrigin);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopBridge);
  app.on("will-quit", stopBridge);
}
