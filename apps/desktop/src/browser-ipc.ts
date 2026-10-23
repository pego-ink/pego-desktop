import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { BROWSER_CHANNELS } from "@/browser-channels";
import { parseBounds, parseCdpRequest } from "@/browser-cdp";
import { parseEmulation } from "@/browser-emulation";
import { createQueue, parseImageUrl } from "@/browser-image";
import { fetchImageAsDataUrl } from "@/browser-image-fetch";
import { createBrowserView, type BrowserView } from "@/browser-view";
import { isTrustedSender } from "@/update-status";

const MAX_IMAGE_FETCHES = 6;

/** One browser view per editor window; the view is created lazily by its first use. */
export const registerBrowserIpc = (appOrigin: string): void => {
  const views = new WeakMap<BrowserWindow, BrowserView>();
  const queues = new WeakMap<BrowserWindow, ReturnType<typeof createQueue>>();

  const viewFor = (event: IpcMainEvent | IpcMainInvokeEvent): BrowserView => {
    if (!isTrustedSender(event.senderFrame?.url, appOrigin)) throw new Error("untrusted sender");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("no window");
    const existing = views.get(win);
    if (existing) return existing;
    const created = createBrowserView(win);
    views.set(win, created);
    return created;
  };

  /** Fire-and-forget channel: untrusted senders and bad payloads are dropped silently. */
  const on = (channel: string, run: (view: BrowserView, payload: unknown) => void): void => {
    ipcMain.on(channel, (event, payload: unknown) => {
      try {
        run(viewFor(event), payload);
      } catch {
        // untrusted sender or destroyed window
      }
    });
  };

  on(BROWSER_CHANNELS.show, (view, payload) => {
    const bounds = parseBounds(payload);
    if (bounds) view.show(bounds);
  });
  on(BROWSER_CHANNELS.setEmulation, (view, payload) => {
    const emulation = parseEmulation(payload);
    if (emulation !== undefined) view.setEmulation(emulation);
  });
  on(BROWSER_CHANNELS.hide, (view) => view.hide());
  on(BROWSER_CHANNELS.back, (view) => view.back());
  on(BROWSER_CHANNELS.forward, (view) => view.forward());
  on(BROWSER_CHANNELS.reload, (view) => view.reload());
  on(BROWSER_CHANNELS.stop, (view) => view.stop());

  ipcMain.handle(BROWSER_CHANNELS.navigate, (event, url: unknown, options: unknown) => {
    const view = viewFor(event);
    if (typeof url !== "string") throw new Error("Enter a URL");
    const allowFile =
      typeof options === "object" &&
      options !== null &&
      (options as { allowFile?: unknown }).allowFile === true;
    return view.navigate(url, { allowFile });
  });
  ipcMain.handle(BROWSER_CHANNELS.cdp, (event, method: unknown, params: unknown) => {
    const view = viewFor(event);
    const request = parseCdpRequest(method, params);
    if (!request) throw new Error("Invalid or disallowed CDP request");
    return view.cdp(request.method, request.params);
  });
  ipcMain.handle(BROWSER_CHANNELS.fetchImage, (event, input: unknown) => {
    const view = viewFor(event);
    const url = parseImageUrl(input);
    if (!url) throw new Error("Only http(s) image URLs are allowed");
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("no window");
    const queue = queues.get(win) ?? createQueue(MAX_IMAGE_FETCHES);
    queues.set(win, queue);
    return queue(() => fetchImageAsDataUrl(url, view.getState().url));
  });
  ipcMain.handle(BROWSER_CHANNELS.getState, (event) => viewFor(event).getState());
};
