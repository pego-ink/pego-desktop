import { describe, expect, test } from "bun:test";
import { clampWidth, keyboardStep, parseStoredWidth, resolveMax } from "@/hooks/panel-width";

const config = { defaultWidth: 300, min: 240, max: 520, maxViewportRatio: 0.4 };

describe("clampWidth", () => {
  test("clamps to range and rounds", () => {
    expect(clampWidth(100, 240, 520)).toBe(240);
    expect(clampWidth(900, 240, 520)).toBe(520);
    expect(clampWidth(300.6, 240, 520)).toBe(301);
  });
});

describe("resolveMax", () => {
  test("uses absolute max on wide viewports", () => {
    expect(resolveMax(config, 2000)).toBe(520);
  });
  test("uses viewport ratio on narrow viewports", () => {
    expect(resolveMax(config, 1000)).toBe(400);
  });
  test("never goes below min", () => {
    expect(resolveMax(config, 400)).toBe(240);
  });
});

describe("parseStoredWidth", () => {
  test("handles invalid input", () => {
    expect(parseStoredWidth(null)).toBeNull();
    expect(parseStoredWidth("")).toBeNull();
    expect(parseStoredWidth("abc")).toBeNull();
    expect(parseStoredWidth("Infinity")).toBeNull();
  });
  test("parses numbers", () => {
    expect(parseStoredWidth("412")).toBe(412);
  });
});

describe("keyboardStep", () => {
  test("16 normally, 64 with shift", () => {
    expect(keyboardStep(false)).toBe(16);
    expect(keyboardStep(true)).toBe(64);
  });
});
