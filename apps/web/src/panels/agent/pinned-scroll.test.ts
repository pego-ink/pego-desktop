import { describe, expect, it } from "bun:test";
import { isNearBottom } from "@/panels/agent/pinned-scroll";

describe("isNearBottom", () => {
  it("is true exactly at the bottom", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
  });
  it("tolerates a small gap", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 580, clientHeight: 400 })).toBe(true);
  });
  it("is false once scrolled up past the threshold", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });
  it("is true when content fits without scrolling", () => {
    expect(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true);
  });
});
