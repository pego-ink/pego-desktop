/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { CONTENT_SECURITY_POLICY, IMAGE_SEARCH_ORIGIN } from "./constants";

const directive = (name: string) =>
  CONTENT_SECURITY_POLICY.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  test("images: the app, data/blob URLs, the image search's proxy and https web pictures", () => {
    const images = directive("img-src").split(" ").slice(1);
    expect(images).toEqual(["'self'", "data:", "blob:", IMAGE_SEARCH_ORIGIN, "https:"]);
    expect(images).not.toContain("http:");
    expect(IMAGE_SEARCH_ORIGIN).toBe("https://api.openverse.org");
  });

  test("scripts stay limited to the app and CanvasKit", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'wasm-unsafe-eval'");
  });
});
