import { describe, expect, test } from "bun:test";
import {
  ALLOWED_CDP_METHODS,
  createRateLimiter,
  isAllowedCdpMethod,
  parseBounds,
  parseCdpRequest,
  parsePageMessage,
} from "@/browser-cdp";

describe("isAllowedCdpMethod", () => {
  test("allows listed methods", () => {
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
      "Page.navigate",
      "DOM.setFileInputFiles",
      "Page.setDownloadBehavior",
      "Page.setBypassCSP",
      "Runtime.addBinding",
      "Runtime.enable",
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

test("allowlist size", () => {
  expect(ALLOWED_CDP_METHODS.size).toBe(39);
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
  const P = "__pego__:";
  test("accepts picked and pick-cancelled", () => {
    expect(parsePageMessage('__pego__:{"type":"picked","tag":"div","text":"hi"}', P)).toEqual({
      type: "picked",
      tag: "div",
      text: "hi",
    });
    expect(parsePageMessage('__pego__:{"type":"pick-cancelled"}', P)).toEqual({
      type: "pick-cancelled",
    });
  });
  test("drops everything else", () => {
    expect(parsePageMessage("__pego__:{bad", P)).toBeUndefined();
    expect(parsePageMessage("hello", P)).toBeUndefined();
    expect(parsePageMessage(5, P)).toBeUndefined();
    expect(parsePageMessage('__pego__:{"type":"other"}', P)).toBeUndefined();
    expect(parsePageMessage('__pego__:["picked"]', P)).toBeUndefined();
    expect(parsePageMessage('__pego__:{"type":"picked","n":1}', P)).toBeUndefined();
    expect(parsePageMessage('__pego__:{"type":"picked","x":{"a":1}}', P)).toBeUndefined();
    const long = "a".repeat(201);
    expect(parsePageMessage(`__pego__:{"type":"picked","text":"${long}"}`, P)).toBeUndefined();
    const huge = `__pego__:{"type":"picked","text":"${"a".repeat(3000)}"}`;
    expect(parsePageMessage(huge, P)).toBeUndefined();
    const unknown = { type: "picked", other: "1" };
    expect(parsePageMessage(`__pego__:${JSON.stringify(unknown)}`, P)).toBeUndefined();
  });

  test("accepts what the picker really sends: nonce, flat fields and a path string", () => {
    const path = JSON.stringify(
      Array.from({ length: 30 }, () => ({ tag: "div", id: "", cls: "c", selector: "a > b" })),
    );
    const picked = {
      type: "picked",
      nonce: "0123456789abcdef0123456789abcdef",
      tag: "button",
      id: "go",
      cls: "cta",
      selector: "#app > button",
      text: "Go",
      path,
    } as const;
    expect(parsePageMessage(`__pego__:${JSON.stringify(picked)}`, P)).toEqual(picked);
    const action = { type: "pick-action", nonce: "n", action: "screenshot" } as const;
    expect(parsePageMessage(`__pego__:${JSON.stringify(action)}`, P)).toEqual(action);
  });

  test("a pick-action needs a known action; the path has its own limit", () => {
    expect(parsePageMessage('__pego__:{"type":"pick-action"}', P)).toBeUndefined();
    expect(parsePageMessage('__pego__:{"type":"pick-action","action":"rm"}', P)).toBeUndefined();
    const tooLong = JSON.stringify({ type: "picked", path: "x".repeat(4001) });
    expect(parsePageMessage(`__pego__:${tooLong}`, P)).toBeUndefined();
  });
});

describe("createRateLimiter", () => {
  test("allows max per second then resets", () => {
    let t = 1000;
    const allow = createRateLimiter(3, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
    t += 1000;
    expect(allow()).toBe(true);
  });
});
