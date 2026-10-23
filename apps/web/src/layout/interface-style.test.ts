/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { INTERFACE_STYLES, insetsWithin, isInterfaceStyle } from "./interface-style";

describe("interface style", () => {
  test("only docked and floating are accepted", () => {
    for (const style of INTERFACE_STYLES) expect(isInterfaceStyle(style)).toBe(true);
    expect(isInterfaceStyle("compact")).toBe(false);
    expect(isInterfaceStyle(null)).toBe(false);
  });

  test("insets are the canvas px between the canvas and the free area, rounded", () => {
    const container = { top: 40, right: 1600, bottom: 900, left: 0 };
    const stage = { top: 48, right: 1288.4, bottom: 892, left: 361.6 };
    expect(insetsWithin(container, stage)).toEqual({ top: 8, right: 312, bottom: 8, left: 362 });
    expect(insetsWithin(container, { ...container, left: -5 }).left).toBe(0);
  });
});
