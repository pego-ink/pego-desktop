import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { APP_ORIGIN, APP_URL } from "@/constants";
import { startBridge, stopBridge } from "@/bridge";
import { installMenu } from "@/menu";
import { registerAppProtocol, registerAppScheme } from "@/protocol";
import { registerUpdateIpc } from "@/update-ipc";
import { VERSION_ARG } from "@/update-status";

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
      additionalArguments: [`${VERSION_ARG}${app.getVersion()}`],
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
    hardenSession();
    installMenu(isDev);
    if (!isDev) registerAppProtocol(webRoot());
    await startBridge();
    await registerUpdateIpc(appOrigin, () => mainWindow);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopBridge);
  app.on("will-quit", stopBridge);
}
