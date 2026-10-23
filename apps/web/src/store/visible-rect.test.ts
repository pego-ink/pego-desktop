/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { visibleRect } from "./use-viewport-store";

const size = { width: 1600, height: 860 };

describe("visibleRect", () => {
  test("docked panels: the whole canvas", () => {
    expect(visibleRect({ size, insets: { top: 0, right: 0, bottom: 0, left: 0 } })).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 860,
    });
  });
  test("floating panels: the area between them", () => {
    expect(visibleRect({ size, insets: { top: 8, right: 312, bottom: 8, left: 362 } })).toEqual({
      x: 362,
      y: 8,
      width: 926,
      height: 844,
    });
  });
  test("a stage too small to fit into (under 200px) falls back to the whole canvas", () => {
    expect(visibleRect({ size, insets: { top: 8, right: 700, bottom: 8, left: 760 } })).toEqual({
      x: 0,
      y: 0,
      width: 1600,
      height: 860,
    });
  });
  test("panels wider than the window fall back to the whole canvas", () => {
    expect(
      visibleRect({
        size: { width: 500, height: 400 },
        insets: { top: 0, right: 300, bottom: 0, left: 300 },
      }),
    ).toEqual({ x: 0, y: 0, width: 500, height: 400 });
  });
});
