import { describe, expect, test } from "bun:test";
import {
  adjacentTab,
  dragShift,
  dropIndex,
  moveItem,
  tabIdForDigit,
  tabShortcut,
} from "./tab-bar-model";

const rects = [0, 100, 200, 300].map((left) => ({ left, width: 100 }));
const key = (over: Partial<Parameters<typeof tabShortcut>[0]>) => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("moveItem", () => {
  test("moves forward and backward", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("dropIndex", () => {
  test("stays until the centre passes a neighbour's centre", () => {
    expect(dropIndex(rects, 1, 0)).toBe(1);
    expect(dropIndex(rects, 1, 40)).toBe(1);
    expect(dropIndex(rects, 1, 110)).toBe(2);
    expect(dropIndex(rects, 1, 260)).toBe(3);
    expect(dropIndex(rects, 2, -160)).toBe(1);
    expect(dropIndex(rects, 2, -900)).toBe(0);
  });
});

describe("dragShift", () => {
  test("neighbours slide out of the way", () => {
    expect(dragShift(2, 1, 3, 100)).toBe(-100);
    expect(dragShift(3, 1, 3, 100)).toBe(-100);
    expect(dragShift(0, 1, 3, 100)).toBe(0);
    expect(dragShift(0, 3, 1, 100)).toBe(0);
    expect(dragShift(1, 3, 1, 100)).toBe(100);
    expect(dragShift(3, 3, 1, 100)).toBe(0);
    expect(dragShift(2, 3, 1, 100)).toBe(100);
  });
});

describe("adjacentTab", () => {
  test("wraps both ways", () => {
    expect(adjacentTab(["a", "b", "c"], "c", 1)).toBe("a");
    expect(adjacentTab(["a", "b", "c"], "a", -1)).toBe("c");
    expect(adjacentTab(["a", "b", "c"], "b", 1)).toBe("c");
  });
  test("no active tab starts from an end; no tabs gives null", () => {
    expect(adjacentTab(["a", "b"], null, 1)).toBe("a");
    expect(adjacentTab(["a", "b"], null, -1)).toBe("b");
    expect(adjacentTab([], null, 1)).toBeNull();
  });
});

describe("tabIdForDigit", () => {
  test("1-8 by position, 9 is the last", () => {
    const ids = ["a", "b", "c"];
    expect(tabIdForDigit(1, ids)).toBe("a");
    expect(tabIdForDigit(3, ids)).toBe("c");
    expect(tabIdForDigit(5, ids)).toBeNull();
    expect(tabIdForDigit(9, ids)).toBe("c");
    expect(tabIdForDigit(0, ids)).toBeNull();
  });
});

describe("tabShortcut", () => {
  test("mac uses Cmd, not Ctrl", () => {
    expect(tabShortcut(key({ key: "t", metaKey: true }), true)).toEqual({ kind: "new" });
    expect(tabShortcut(key({ key: "w", metaKey: true }), true)).toEqual({ kind: "close" });
    expect(tabShortcut(key({ key: "t", ctrlKey: true }), true)).toBeNull();
    expect(tabShortcut(key({ key: "2", code: "Digit2", metaKey: true }), true)).toEqual({
      kind: "goto",
      digit: 2,
    });
  });
  test("other platforms use Ctrl", () => {
    expect(tabShortcut(key({ key: "w", ctrlKey: true }), false)).toEqual({ kind: "close" });
    expect(tabShortcut(key({ key: "w", metaKey: true }), false)).toBeNull();
  });
  test("Ctrl+Tab steps on every platform", () => {
    expect(tabShortcut(key({ key: "Tab", ctrlKey: true }), true)).toEqual({
      kind: "step",
      step: 1,
    });
    expect(tabShortcut(key({ key: "Tab", ctrlKey: true, shiftKey: true }), false)).toEqual({
      kind: "step",
      step: -1,
    });
  });
  test("does not clash with other shortcuts", () => {
    expect(tabShortcut(key({ key: "w", metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(tabShortcut(key({ key: "k", metaKey: true }), true)).toBeNull();
    expect(tabShortcut(key({ key: "!", code: "Digit1", shiftKey: true }), true)).toBeNull();
    expect(tabShortcut(key({ key: "1", code: "Digit1", altKey: true }), true)).toBeNull();
    expect(tabShortcut(key({ key: ",", metaKey: true }), true)).toBeNull();
  });
});
