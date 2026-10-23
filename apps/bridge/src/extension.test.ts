import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isExtensionOrigin,
  loadExtensionToken,
  parseCapture,
  readTextLimited,
  tokenMatches,
} from "./extension";

const page = { url: "https://ayam.test/menu", title: "Menu" };

describe("browser extension pairing", () => {
  test("the pairing code is created once, owner-only, and kept", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "pego-token-")), "nested", "extension-token");
    const first = await loadExtensionToken(path);
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(await loadExtensionToken(path)).toBe(first);
    expect((await readFile(path, "utf8")).trim()).toBe(first);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("only extension origins; codes compare exactly", () => {
    expect(isExtensionOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop")).toBe(true);
    expect(isExtensionOrigin("moz-extension://1f2e3d4c-aaaa-bbbb-cccc-1234567890ab")).toBe(true);
    for (const origin of [
      null,
      "https://evil.test",
      "http://localhost:5173",
      "chrome-extension://a/b",
    ]) {
      expect(isExtensionOrigin(origin)).toBe(false);
    }
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches("ab", "abc")).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
    // Same string length, different byte length: refused, not thrown.
    expect(tokenMatches("é".repeat(3), "abc")).toBe(false);
    expect(tokenMatches("ab\u00e9", "abc")).toBe(false);
  });

  test("a body over the limit is refused by its bytes, chunked or not", async () => {
    const post = (body: string | ReadableStream<Uint8Array>) =>
      new Request("http://127.0.0.1/x", { method: "POST", body });
    expect(await readTextLimited(post("héllo"), 6)).toBe("héllo");
    expect(await readTextLimited(post("héllo"), 5)).toBeNull(); // 5 characters, 6 bytes
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    expect(await readTextLimited(post(chunked), 10)).toBeNull();
  });

  test("captures are checked for shape", () => {
    const snapshot = { url: page.url, title: "Menu", root: { kind: "element" } };
    expect(parseCapture({ kind: "snapshot", page, fullPage: true, snapshot }) as unknown).toEqual({
      kind: "snapshot",
      page,
      fullPage: true,
      snapshot,
    });
    expect(
      parseCapture({
        kind: "screenshot",
        page,
        dataUrl: "data:image/png;base64,AAAA",
        width: 10,
        height: 5,
      }),
    ).toMatchObject({ kind: "screenshot", width: 10 });
    expect(parseCapture({ kind: "snapshot", page: { url: "javascript:x" }, snapshot })).toBeNull();
    expect(parseCapture({ kind: "snapshot", page, snapshot: { root: "x" } })).toBeNull();
    expect(
      parseCapture({
        kind: "screenshot",
        page,
        dataUrl: "data:image/svg+xml;base64,AAAA",
        width: 1,
        height: 1,
      }),
    ).toBeNull();
    expect(parseCapture({ kind: "html", page })).toBeNull();
  });
});
