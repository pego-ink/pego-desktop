/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { INTERFACE_STYLES, isInterfaceStyle } from "./interface-style";

describe("interface style", () => {
  test("only docked and floating are accepted", () => {
    for (const style of INTERFACE_STYLES) expect(isInterfaceStyle(style)).toBe(true);
    expect(isInterfaceStyle("compact")).toBe(false);
    expect(isInterfaceStyle(null)).toBe(false);
  });
});
