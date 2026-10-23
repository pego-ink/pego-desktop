/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { BrowserHost, BrowserTarget } from "@pego/agent";
import { captureSource } from "./refresh-snapshot";

const fake = (url: string) => {
  const calls: unknown[] = [];
  const browser = {
    currentPage: () => ({ url, title: "" }),
    loadPage: async (next: string) => {
      calls.push(["load", next]);
      return { url: next, title: "" };
    },
    screenshot: async (target: BrowserTarget) => {
      calls.push(["shot", target]);
      return { dataUrl: "data:image/webp;base64,AAAA", width: 1, height: 1 };
    },
  } as unknown as BrowserHost;
  return { browser, calls };
};

describe("refreshing a screenshot", () => {
  test("captures the same element again, loading its page only when another is shown", async () => {
    const same = fake("https://x.test/");
    await captureSource(same.browser, { url: "https://x.test/", selector: "#hero" });
    expect(same.calls).toEqual([["shot", { kind: "query", selector: "#hero" }]]);

    const other = fake("https://y.test/");
    expect(await captureSource(other.browser, { url: "https://x.test/" })).toStartWith("data:");
    expect(other.calls).toEqual([
      ["load", "https://x.test/"],
      ["shot", { kind: "full-page" }],
    ]);
  });
});
