import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { APP_ORIGIN, APP_URL } from "@/constants";
import { startBridge, stopBridge } from "@/bridge";
import { installMenu } from "@/menu";
import { registerAppProtocol, registerAppScheme } from "@/protocol";

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

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#141418",
    title: "Pego",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
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

const hardenSession = (): void => {
  // The editor needs no device permissions; File System Access pickers are not permission-gated.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
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
    hardenSession();
    installMenu(isDev);
    if (!isDev) registerAppProtocol(webRoot());
    await startBridge();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopBridge);
  app.on("will-quit", stopBridge);
}
