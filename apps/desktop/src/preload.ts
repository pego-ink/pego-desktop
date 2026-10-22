import { contextBridge } from "electron";

// Sandboxed preload: exposes only a static flag so the web app can tell it runs in the desktop shell.
contextBridge.exposeInMainWorld("pegoDesktop", { platform: process.platform });
