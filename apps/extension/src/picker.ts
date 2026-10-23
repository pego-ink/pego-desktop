/**
 * Element picker, injected into the page when the user chooses "Pick an element": outlines the
 * element under the pointer; a click marks it (data-pego-picked, what Pego's snapshot script
 * captures as the selection) and tells the service worker, Esc cancels. Its own nodes carry
 * data-pego-overlay so the snapshot leaves them out. Injecting it again restarts it.
 */
const OVERLAY = "data-pego-overlay";
const PICKED = "data-pego-picked";
const STOP = "__pegoPickerStop";

type PickerWindow = Window & { [STOP]?: () => void };
const win = window as PickerWindow;
win[STOP]?.();

const box = document.createElement("div");
box.setAttribute(OVERLAY, "");
box.style.cssText =
  "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c5cff;background:rgba(124,92,255,.12);border-radius:3px;transition:all 60ms ease-out;display:none";
const label = document.createElement("div");
label.setAttribute(OVERLAY, "");
label.style.cssText =
  "position:fixed;z-index:2147483647;pointer-events:none;font:12px/1.4 system-ui,sans-serif;color:#fff;background:#7c5cff;padding:2px 6px;border-radius:4px;display:none";
document.documentElement.append(box, label);

let current: Element | null = null;

const describe = (el: Element) => {
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean)[0] : "";
  return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ""}`;
};

const onMove = (event: MouseEvent) => {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (!el || el.hasAttribute(OVERLAY) || el === current) return;
  current = el;
  const r = el.getBoundingClientRect();
  Object.assign(box.style, {
    display: "block",
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  label.textContent = `${describe(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  Object.assign(label.style, {
    display: "block",
    left: `${Math.max(4, r.left)}px`,
    top: `${Math.max(4, r.top - 24)}px`,
  });
};

const stopPicker = () => {
  removeEventListener("mousemove", onMove, true);
  removeEventListener("click", onClick, true);
  removeEventListener("keydown", onKey, true);
  box.remove();
  label.remove();
  delete win[STOP];
};

function onClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const picked = current ?? document.elementFromPoint(event.clientX, event.clientY);
  stopPicker();
  if (!picked) return;
  for (const el of document.querySelectorAll(`[${PICKED}]`)) el.removeAttribute(PICKED);
  picked.setAttribute(PICKED, "");
  showToast("Sending to Pego…", true);
  void chrome.runtime.sendMessage({ type: "picked" });
}

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  stopPicker();
  void chrome.runtime.sendMessage({ type: "pick-cancelled" });
}

/** A short message at the bottom right of the page. */
function showToast(text: string, ok: boolean) {
  document.querySelectorAll("[data-pego-toast]").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.setAttribute(OVERLAY, "");
  toast.setAttribute("data-pego-toast", "");
  toast.textContent = text;
  toast.style.cssText = `position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;font:13px/1.4 system-ui,sans-serif;color:#fff;background:${ok ? "#1f1f24" : "#b42318"};padding:10px 14px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25)`;
  document.documentElement.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

// One status listener per page, however often the picker is injected.
const LISTENING = "__pegoToastListening";
const flags = window as unknown as Record<string, boolean>;
if (!flags[LISTENING]) {
  flags[LISTENING] = true;
  chrome.runtime.onMessage.addListener((message) => {
    const status = message as { type?: string; ok?: boolean; message?: string };
    if (status.type === "pego-status") showToast(status.message ?? "", status.ok === true);
  });
}

addEventListener("mousemove", onMove, true);
addEventListener("click", onClick, true);
addEventListener("keydown", onKey, true);
win[STOP] = stopPicker;

// A module: its names stay local (and never clash with globals like window.stop).
export {};
