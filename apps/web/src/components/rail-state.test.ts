import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RAIL_STATE,
  moveRailFocus,
  parseRailState,
  pressTab,
  railTabForShortcut,
} from "./rail-state";

const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});

describe("parseRailState", () => {
  test("defaults to agent open", () => {
    expect(parseRailState(null)).toEqual({ tab: "agent", open: true });
    expect(DEFAULT_RAIL_STATE.tab).toBe("agent");
  });
  test("restores a valid value", () => {
    expect(parseRailState('{"tab":"layers","open":false}')).toEqual({ tab: "layers", open: false });
  });
  test("falls back per field on bad data", () => {
    expect(parseRailState('{"tab":"nope","open":"x"}')).toEqual(DEFAULT_RAIL_STATE);
    expect(parseRailState("{oops")).toEqual(DEFAULT_RAIL_STATE);
    expect(parseRailState("null")).toEqual(DEFAULT_RAIL_STATE);
  });
});

describe("pressTab", () => {
  test("active tab collapses", () => {
    expect(pressTab({ tab: "agent", open: true }, "agent")).toEqual({ tab: "agent", open: false });
  });
  test("other tab opens", () => {
    expect(pressTab({ tab: "agent", open: true }, "layers")).toEqual({ tab: "layers", open: true });
  });
  test("collapsed tab reopens", () => {
    expect(pressTab({ tab: "agent", open: false }, "agent")).toEqual({ tab: "agent", open: true });
  });
});

describe("moveRailFocus", () => {
  test("wraps and jumps", () => {
    expect(moveRailFocus(0, "ArrowDown", 2)).toBe(1);
    expect(moveRailFocus(1, "ArrowDown", 2)).toBe(0);
    expect(moveRailFocus(0, "ArrowUp", 2)).toBe(1);
    expect(moveRailFocus(1, "Home", 2)).toBe(0);
    expect(moveRailFocus(0, "End", 2)).toBe(1);
    expect(moveRailFocus(0, "a", 2)).toBeNull();
  });
});

describe("railTabForShortcut", () => {
  test("alt+1 / alt+2", () => {
    expect(railTabForShortcut(key("Digit1"))).toBe("agent");
    expect(railTabForShortcut(key("Digit2"))).toBe("layers");
    expect(railTabForShortcut(key("Digit3"))).toBe("assets");
  });
  test("ignores other combos", () => {
    expect(railTabForShortcut(key("Digit4"))).toBeNull();
    expect(railTabForShortcut(key("Digit1", { shiftKey: true }))).toBeNull();
    expect(railTabForShortcut(key("Digit1", { metaKey: true }))).toBeNull();
    expect(railTabForShortcut(key("Digit1", { altKey: false }))).toBeNull();
  });
});
