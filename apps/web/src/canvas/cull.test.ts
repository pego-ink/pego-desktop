import { describe, expect, test } from "bun:test";
import { computeLayout, type PegoDocument } from "@pego/doc";
import { boxesTouch, computePaintBounds, paintReach, visibleArea } from "./cull";

const doc: PegoDocument = {
  version: 7,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "page",
      id: "p",
      name: "P",
      x: 0,
      y: 0,
      children: [
        {
          type: "frame",
          id: "open",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          layout: "none",
          children: [{ type: "rectangle", id: "out", x: 300, y: 0, width: 50, height: 50 }],
        },
        {
          type: "frame",
          id: "clipped",
          x: 0,
          y: 200,
          width: 100,
          height: 100,
          layout: "none",
          clip: true,
          children: [{ type: "rectangle", id: "hidden", x: 300, y: 0, width: 50, height: 50 }],
        },
        {
          type: "rectangle",
          id: "shadow",
          x: 0,
          y: 400,
          width: 100,
          height: 100,
          effects: [{ type: "shadow", color: "#000000", x: 0, y: 20, blur: 40 }],
        },
        { type: "rectangle", id: "turned", x: 0, y: 600, width: 100, height: 10, rotation: 45 },
      ],
    },
  ],
};

describe("viewport culling bounds", () => {
  const bounds = computePaintBounds(
    doc,
    computeLayout(doc, () => ({ width: 0, height: 0 })),
  );

  test("an unclipped frame reaches its overflowing children; a clipped one does not", () => {
    expect(bounds.get("open")).toEqual({ x: 0, y: 0, width: 350, height: 100 });
    expect(bounds.get("clipped")).toEqual({ x: 0, y: 200, width: 100, height: 100 });
  });

  test("shadows and rotation grow the bounds", () => {
    expect(paintReach(doc.children[0]!.children[2]!, {})).toBe(80);
    const turned = bounds.get("turned")!;
    expect(turned.width).toBeGreaterThan(100 * 2);
  });

  test("the visible area follows the camera", () => {
    const view = visibleArea({ panX: -200, panY: -100, zoom: 2 }, 800, 400);
    expect(view).toEqual({ x: 100, y: 50, width: 400, height: 200 });
    // The shadow reaches up to y 320, past this view's bottom (250).
    expect(boxesTouch(bounds.get("open")!, view)).toBe(true);
    expect(boxesTouch(bounds.get("shadow")!, view)).toBe(false);
  });
});
