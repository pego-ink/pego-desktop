import {
  canCapture,
  readSettings,
  readSnapshotResult,
  screenshotCapture,
  sendCapture,
  snapshotCapture,
  type Settings,
} from "./capture";

/**
 * The extension's service worker: runs Pego's snapshot script in the page (capture-page.js or,
 * after the picker, capture-picked.js), screenshots the visible tab, and sends the result to the
 * local Pego bridge, which hands it to the open editor.
 */

/** Requests from the popup and the picker. */
export type Request =
  | { type: "send-page"; tabId: number }
  | { type: "pick"; tabId: number }
  | { type: "screenshot"; tabId: number }
  | { type: "picked" }
  | { type: "pick-cancelled" };

export type Reply = { ok: true; message: string } | { ok: false; message: string };

const settings = async (): Promise<Settings> =>
  readSettings(await chrome.storage.local.get(["code", "port"]));

const runFile = async (tabId: number, file: string): Promise<unknown> =>
  (await chrome.scripting.executeScript({ target: { tabId }, files: [file] }))[0]?.result;

const capturable = async (tabId: number) => {
  const tab = await chrome.tabs.get(tabId);
  if (!canCapture(tab.url)) throw new Error("Pego can capture web pages only (http or https).");
  return tab;
};

const sendPage = async (tabId: number, file: string, fullPage: boolean): Promise<string> => {
  await capturable(tabId);
  const snapshot = readSnapshotResult(await runFile(tabId, file));
  return sendCapture(snapshotCapture(snapshot, fullPage), await settings());
};

const screenshot = async (tabId: number): Promise<string> => {
  const tab = await capturable(tabId);
  const [view] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      width: innerWidth,
      height: innerHeight,
      url: location.href,
      title: document.title,
    }),
  });
  const info = view?.result as { width: number; height: number; url: string; title: string };
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return sendCapture(
    screenshotCapture({ url: info.url, title: info.title }, dataUrl, info),
    await settings(),
  );
};

/** Tell the picker's page what happened (it shows a short toast). */
const notifyTab = (tabId: number, reply: Reply) =>
  chrome.tabs.sendMessage(tabId, { type: "pego-status", ...reply }).catch(() => undefined);

const settle = async (work: Promise<string>): Promise<Reply> => {
  try {
    return { ok: true, message: await work };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Handle one request (also callable from tests through `self.pegoHandle`). */
export const handle = async (request: Request, senderTabId?: number): Promise<Reply> => {
  switch (request.type) {
    case "send-page":
      return settle(sendPage(request.tabId, "capture-page.js", true));
    case "screenshot":
      return settle(screenshot(request.tabId));
    case "pick":
      return settle(
        capturable(request.tabId)
          .then(() => runFile(request.tabId, "picker.js"))
          .then(() => "Click an element on the page to send it to Pego (Esc cancels)."),
      );
    case "picked": {
      if (senderTabId === undefined) return { ok: false, message: "No tab." };
      const reply = await settle(sendPage(senderTabId, "capture-picked.js", false));
      // The picked element keeps no trace in the page.
      await chrome.scripting
        .executeScript({
          target: { tabId: senderTabId },
          func: () => {
            for (const el of document.querySelectorAll("[data-pego-picked]")) {
              el.removeAttribute("data-pego-picked");
            }
          },
        })
        .catch(() => undefined);
      await notifyTab(senderTabId, reply);
      return reply;
    }
    case "pick-cancelled":
      return { ok: true, message: "Cancelled." };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handle(message as Request, sender.tab?.id).then(sendResponse);
  return true; // answered asynchronously
});

(self as unknown as { pegoHandle: typeof handle }).pegoHandle = handle;
