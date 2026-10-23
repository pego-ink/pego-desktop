import { describe, expect, test } from "bun:test";
import type { Layout, PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
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
  test("with the document, a rotated node counts with its rotated outline", () => {
    const doc = {
      version: 4,
      id: "d",
      name: "d",
      variables: {},
      children: [
        {
          type: "page",
          id: "p",
          name: "Page 1",
          x: 0,
          y: 0,
          children: [
            { type: "rectangle", id: "r", x: 0, y: 0, width: 100, height: 20, rotation: 90 },
          ],
        },
      ],
    } as unknown as PegoDocument;
    const box = selectionBounds(getLayout(doc), ["r"], doc)!;
    expect(box.width).toBeCloseTo(20);
    expect(box.height).toBeCloseTo(100);
    // Without the document only the unrotated layout box is known.
    expect(selectionBounds(getLayout(doc), ["r"])).toEqual({ x: 0, y: 0, width: 100, height: 20 });
  });
});

test("formatZoomPercent rounds", () => {
  expect(formatZoomPercent(1)).toBe("100%");
  expect(formatZoomPercent(1.256)).toBe("126%");
  expect(formatZoomPercent(0.0249)).toBe("2%");
});
