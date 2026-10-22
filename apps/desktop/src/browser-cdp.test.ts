import { describe, expect, test } from "bun:test";
import { isAllowedCdpMethod, parseBounds, parseCdpRequest, parsePageMessage } from "@/browser-cdp";

describe("isAllowedCdpMethod", () => {
  test("allows the six domains", () => {
    for (const m of [
      "DOM.getDocument",
      "Input.dispatchMouseEvent",
      "Page.captureScreenshot",
      "Runtime.evaluate",
      "Emulation.setDeviceMetricsOverride",
      "CSS.getComputedStyleForNode",
      "Accessibility.getFullAXTree",
    ]) {
      expect(isAllowedCdpMethod(m)).toBe(true);
    }
  });
  test("rejects everything else", () => {
    for (const m of [
      "Network.enable",
      "Browser.close",
      "Target.createTarget",
      "DOM",
      "DOM.",
      "dom.x",
      "DOM.a.b",
      "",
      1,
      null,
    ]) {
      expect(isAllowedCdpMethod(m)).toBe(false);
    }
  });
});

describe("parseCdpRequest", () => {
  test("validates method and params", () => {
    expect(parseCdpRequest("DOM.getDocument", undefined)).toEqual({ method: "DOM.getDocument" });
    expect(parseCdpRequest("DOM.getDocument", { depth: 1 })).toEqual({
      method: "DOM.getDocument",
      params: { depth: 1 },
    });
    expect(parseCdpRequest("DOM.getDocument", [1])).toBeNull();
    expect(parseCdpRequest("Network.enable", {})).toBeNull();
  });
});

describe("parseBounds", () => {
  test("rounds valid bounds", () => {
    expect(parseBounds({ x: 1.4, y: 2.6, width: 100.5, height: 50 })).toEqual({
      x: 1,
      y: 3,
      width: 101,
      height: 50,
    });
  });
  test("rejects invalid bounds", () => {
    expect(parseBounds(null)).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: -1, height: 5 })).toBeNull();
    expect(parseBounds({ x: NaN, y: 0, width: 1, height: 5 })).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: Infinity, height: 5 })).toBeNull();
    expect(parseBounds({ x: 0, y: 0, width: "1", height: 5 })).toBeNull();
  });
});

describe("parsePageMessage", () => {
  test("parses prefixed JSON and ignores the rest", () => {
    expect(parsePageMessage('__pego__:{"type":"picked"}', "__pego__:")).toEqual({ type: "picked" });
    expect(parsePageMessage("__pego__:{bad", "__pego__:")).toBeUndefined();
    expect(parsePageMessage("hello", "__pego__:")).toBeUndefined();
    expect(parsePageMessage(5, "__pego__:")).toBeUndefined();
  });
});
