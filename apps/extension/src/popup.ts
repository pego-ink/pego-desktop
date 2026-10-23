import { DEFAULT_PORT, readSettings } from "./capture";
import type { Reply, Request } from "./background";

/** The toolbar popup: three actions for the current tab, and the pairing settings. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const buttons = ["page", "pick", "shot"].map((id) => $<HTMLButtonElement>(id));

const show = (reply: Reply | { ok: boolean; message: string }) => {
  status.textContent = reply.message;
  status.classList.toggle("bad", !reply.ok);
};

const activeTabId = async (): Promise<number | undefined> =>
  (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

const run = async (type: "send-page" | "pick" | "screenshot", busy: string) => {
  const tabId = await activeTabId();
  if (tabId === undefined) return show({ ok: false, message: "No tab to capture." });
  for (const button of buttons) button.disabled = true;
  show({ ok: true, message: busy });
  const reply = (await chrome.runtime.sendMessage({ type, tabId } satisfies Request)) as Reply;
  show(reply);
  for (const button of buttons) button.disabled = false;
  // Picking happens in the page: get out of the way.
  if (type === "pick" && reply.ok) window.close();
};

$("page").addEventListener("click", () => void run("send-page", "Reading the page…"));
$("pick").addEventListener("click", () => void run("pick", "Starting the picker…"));
$("shot").addEventListener("click", () => void run("screenshot", "Taking a screenshot…"));

const code = $<HTMLInputElement>("code");
const port = $<HTMLInputElement>("port");

void chrome.storage.local.get(["code", "port"]).then((raw) => {
  const settings = readSettings(raw);
  code.value = settings.code;
  port.value = settings.port === DEFAULT_PORT ? "" : String(settings.port);
  // Not paired yet: open the pairing settings.
  if (!settings.code) ($("settings") as HTMLDetailsElement).open = true;
});

$("save").addEventListener("click", () => {
  const settings = readSettings({ code: code.value, port: port.value || DEFAULT_PORT });
  if (!settings.code) return show({ ok: false, message: "That pairing code is not right." });
  void chrome.storage.local.set(settings).then(() => show({ ok: true, message: "Saved." }));
});
