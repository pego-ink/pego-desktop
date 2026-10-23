import { describe, expect, test } from "bun:test";
import {
  createQueue,
  isDeclaredSizeOk,
  MAX_IMAGE_BYTES,
  parseImageContentType,
  parseImageUrl,
  resolveRedirect,
} from "@/browser-image";

describe("parseImageUrl", () => {
  test("accepts http(s) only", () => {
    expect(parseImageUrl("https://a.com/x.png")).toBe("https://a.com/x.png");
    expect(parseImageUrl("http://a.com/x.png")).toBe("http://a.com/x.png");
    for (const bad of [
      "file:///etc/passwd",
      "data:image/png;base64,AA",
      "blob:https://a/1",
      "chrome://gpu",
      "javascript:1",
      "nope",
      "",
      5,
      null,
    ])
      expect(parseImageUrl(bad)).toBeNull();
  });
  test("rejects long urls", () => {
    expect(parseImageUrl(`https://a.com/${"a".repeat(4096)}`)).toBeNull();
  });
});

describe("parseImageContentType", () => {
  test("image types only", () => {
    expect(parseImageContentType("Image/PNG; charset=x")).toBe("image/png");
    expect(parseImageContentType("image/svg+xml")).toBe("image/svg+xml");
    expect(parseImageContentType("text/html")).toBeNull();
    expect(parseImageContentType(null)).toBeNull();
    expect(parseImageContentType("image/")).toBeNull();
  });
});

describe("isDeclaredSizeOk", () => {
  test("limits", () => {
    expect(isDeclaredSizeOk(null)).toBe(true);
    expect(isDeclaredSizeOk(String(MAX_IMAGE_BYTES))).toBe(true);
    expect(isDeclaredSizeOk(String(MAX_IMAGE_BYTES + 1))).toBe(false);
    expect(isDeclaredSizeOk("abc")).toBe(false);
  });
});

describe("resolveRedirect", () => {
  test("keeps http(s) only", () => {
    expect(resolveRedirect("/b.png", "https://a.com/x")).toBe("https://a.com/b.png");
    expect(resolveRedirect("file:///etc/passwd", "https://a.com/x")).toBeNull();
    expect(resolveRedirect(null, "https://a.com/x")).toBeNull();
  });
});

describe("createQueue", () => {
  test("limits concurrency", async () => {
    const run = createQueue(2);
    let active = 0;
    let peak = 0;
    const task = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    };
    await Promise.all(Array.from({ length: 7 }, () => run(task)));
    expect(peak).toBe(2);
  });
});
