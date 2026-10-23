import { describe, expect, test } from "bun:test";
import {
  canCapture,
  DEFAULT_PORT,
  importUrl,
  readSettings,
  readSnapshotResult,
  screenshotCapture,
  sendCapture,
  snapshotCapture,
} from "./capture";

const CODE = "a".repeat(48);
const snapshot = {
  url: "https://ayam.test/",
  title: "Ayam",
  root: {
    kind: "element",
    tag: "body",
    box: { x: 0, y: 0, width: 10, height: 10 },
    style: {},
    children: [],
  },
} as const;

describe("extension capture helpers", () => {
  test("settings: a 48-hex code and a valid port, else defaults", () => {
    expect(readSettings({ code: ` ${CODE} `, port: "4598" })).toEqual({ code: CODE, port: 4598 });
    expect(readSettings({ code: "short", port: 99999 })).toEqual({ code: "", port: DEFAULT_PORT });
    expect(importUrl(4519)).toBe("http://127.0.0.1:4519/extension/import");
  });

  test("the page script's JSON becomes a snapshot or its error", () => {
    expect(readSnapshotResult(JSON.stringify({ ok: snapshot }))).toEqual(snapshot as never);
    expect(() => readSnapshotResult(JSON.stringify({ error: "No element picked" }))).toThrow(
      "No element picked",
    );
    expect(() => readSnapshotResult(undefined)).toThrow("could not be read");
    expect(() => readSnapshotResult("{")).toThrow("could not be read");
  });

  test("capture bodies match what the bridge expects", () => {
    expect(snapshotCapture(snapshot as never, true)).toEqual({
      kind: "snapshot",
      page: { url: "https://ayam.test/", title: "Ayam" },
      fullPage: true,
      snapshot: snapshot as never,
    });
    expect(
      screenshotCapture({ url: "https://a.test/", title: "A" }, "data:image/png;base64,AA", {
        width: 1280.4,
        height: 719.6,
      }),
    ).toMatchObject({ kind: "screenshot", width: 1280, height: 720 });
  });

  test("only web pages can be captured", () => {
    expect(canCapture("https://ayam.test/")).toBe(true);
    expect(canCapture("chrome://extensions")).toBe(false);
    expect(canCapture("file:///tmp/a.html")).toBe(false);
    expect(canCapture(undefined)).toBe(false);
  });

  test("sending: the code goes in a header; errors say what to do", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response("Imported Ayam");
    }) as unknown as typeof fetch;
    const capture = snapshotCapture(snapshot as never, true);
    expect(await sendCapture(capture, { code: CODE, port: 4519 }, ok)).toBe("Imported Ayam");
    expect(seen[0]?.url).toBe("http://127.0.0.1:4519/extension/import");
    expect((seen[0]?.init.headers as Record<string, string>)["x-pego-token"]).toBe(CODE);

    await expect(sendCapture(capture, { code: "", port: 4519 }, ok)).rejects.toThrow(
      /pairing code/,
    );
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(sendCapture(capture, { code: CODE, port: 4519 }, down)).rejects.toThrow(
      /not running on port 4519/,
    );
    const wrong = (async () =>
      new Response("Wrong pairing code.", { status: 401 })) as unknown as typeof fetch;
    await expect(sendCapture(capture, { code: CODE, port: 4519 }, wrong)).rejects.toThrow(
      "Wrong pairing code.",
    );
  });
});
