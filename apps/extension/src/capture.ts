import type { DomSnapshot, ExtensionCapture } from "@pego/agent";

/** The bridge's default port (the desktop app and `bun run dev` use it). */
export const DEFAULT_PORT = 4519;

export type Settings = { code: string; port: number };

/** Stored settings, with anything missing or odd replaced by defaults. */
export const readSettings = (raw: Record<string, unknown>): Settings => {
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  const port = Number(raw.port);
  return {
    code: /^[0-9a-f]{48}$/.test(code) ? code : "",
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
  };
};

/** The bridge's import route; only loopback, so a capture never leaves the machine. */
export const importUrl = (port: number): string => `http://127.0.0.1:${port}/extension/import`;

/**
 * The value of Pego's page snapshot script (capture-page.js / capture-picked.js): a JSON string
 * `{ ok: snapshot } | { error }`. Throws the page-side error, or when the script gave nothing.
 */
export const readSnapshotResult = (result: unknown): DomSnapshot => {
  if (typeof result !== "string") throw new Error("The page could not be read.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new Error("The page could not be read.");
  }
  const value = parsed as { ok?: DomSnapshot; error?: string };
  if (value.error) throw new Error(value.error);
  if (!value.ok || typeof value.ok !== "object" || !value.ok.root) {
    throw new Error("The page could not be read.");
  }
  return value.ok;
};

/** The body the bridge expects for a page or element snapshot. */
export const snapshotCapture = (snapshot: DomSnapshot, fullPage: boolean): ExtensionCapture => ({
  kind: "snapshot",
  page: { url: snapshot.url, title: snapshot.title },
  fullPage,
  snapshot,
});

/** The body the bridge expects for a visible-tab screenshot (size in CSS pixels). */
export const screenshotCapture = (
  page: { url: string; title: string },
  dataUrl: string,
  size: { width: number; height: number },
): ExtensionCapture => ({
  kind: "screenshot",
  page,
  dataUrl,
  width: Math.round(size.width),
  height: Math.round(size.height),
});

/** Pages the extension cannot capture (browser pages, the web store, files). */
export const canCapture = (url: string | undefined): boolean => !!url && /^https?:\/\//i.test(url);

/**
 * Send a capture to the bridge. Resolves to the editor's answer ("Imported …"); rejects with a
 * message the user can act on.
 */
export const sendCapture = async (
  capture: ExtensionCapture,
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  if (!settings.code) {
    throw new Error(
      "Paste the pairing code from Pego (Settings › Agent & Models › Browser extension).",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(importUrl(settings.port), {
      method: "POST",
      headers: { "content-type": "application/json", "x-pego-token": settings.code },
      body: JSON.stringify(capture),
    });
  } catch {
    throw new Error(
      `Pego's bridge is not running on port ${settings.port}. Open Pego (the desktop app, or bun run dev).`,
    );
  }
  const text = (await response.text().catch(() => "")).slice(0, 300);
  if (!response.ok) throw new Error(text || `The bridge answered HTTP ${response.status}.`);
  return text || "Sent to Pego.";
};
