import { describe, expect, test } from "bun:test";
import type { Layout } from "@pego/doc";
import { formatZoomPercent, selectionBounds } from "./zoom-utils";

const layout: Layout = new Map([
  ["a", { x: 0, y: 0, width: 10, height: 10 }],
  ["b", { x: 20, y: -5, width: 10, height: 10 }],
]);

describe("selectionBounds", () => {
  test("unions the selected boxes", () => {
    expect(selectionBounds(layout, ["a", "b"])).toEqual({ x: 0, y: -5, width: 30, height: 15 });
  });
  test("ignores unknown ids; null when nothing resolves", () => {
    expect(selectionBounds(layout, ["a", "zz"])).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(selectionBounds(layout, [])).toBeNull();
    expect(selectionBounds(layout, ["zz"])).toBeNull();
  });
});

test("formatZoomPercent rounds", () => {
  expect(formatZoomPercent(1)).toBe("100%");
  expect(formatZoomPercent(1.256)).toBe("126%");
  expect(formatZoomPercent(0.0249)).toBe("2%");
});
