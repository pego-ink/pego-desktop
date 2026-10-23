import { describe, expect, test } from "bun:test";
import type { Layout, PegoDocument } from "@pego/doc";
import {
  findNodePath,
  flipAffine,
  IDENTITY,
  nodeToDocAffine,
  placeAffine,
} from "@/canvas/node-transform";

const apply = (m: ReturnType<typeof placeAffine>, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

describe("placeAffine", () => {
  test("translation only", () => {
    expect(apply(placeAffine(IDENTITY, 10, 5, 0), 1, 2)).toEqual({ x: 11, y: 7 });
  });

  test("90 degrees clockwise on a y-down canvas", () => {
    const p = apply(placeAffine(IDENTITY, 0, 0, 90), 10, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("nodeToDocAffine", () => {
  const doc = {
    variables: {},
    children: [
      {
        id: "page",
        type: "page",
        children: [
          {
            id: "g",
            type: "group",
            rotation: 90,
            children: [{ id: "r", type: "rectangle", children: undefined }],
          },
        ],
      },
    ],
  } as unknown as PegoDocument;
  const layout: Layout = new Map([
    ["g", { x: 100, y: 100, width: 50, height: 50 }],
    ["r", { x: 110, y: 100, width: 10, height: 10 }],
  ]);

  test("finds the ancestor chain", () => {
    expect(findNodePath(doc, "r")?.map((n) => n.id)).toEqual(["g", "r"]);
    expect(findNodePath(doc, "missing")).toBeNull();
  });

  test("child corner follows the rotated parent (rotation 90 = counter-clockwise)", () => {
    // Rotation 90 is rendered as canvas.rotate(-90): the child's local +x offset of 10 turns
    // into -y around the group's top-left at (100, 100).
    const path = findNodePath(doc, "r")!;
    const m = nodeToDocAffine(doc, layout, path)!;
    const corner = apply(m, 0, 0);
    expect(corner.x).toBeCloseTo(100);
    expect(corner.y).toBeCloseTo(90);
  });

  test("null when a node has no layout box", () => {
    expect(nodeToDocAffine(doc, new Map(), findNodePath(doc, "g")!)).toBeNull();
  });
});

describe("flip", () => {
  const doc = {
    variables: {},
    children: [
      {
        id: "page",
        type: "page",
        children: [
          {
            id: "f",
            type: "frame",
            flipX: true,
            rotation: 90,
            children: [{ id: "c", type: "rectangle" }],
          },
        ],
      },
    ],
  } as unknown as PegoDocument;
  const layout: Layout = new Map([
    ["f", { x: 100, y: 100, width: 50, height: 20 }],
    ["c", { x: 110, y: 105, width: 10, height: 10 }],
  ]);

  test("flipAffine mirrors around the box center", () => {
    const m = flipAffine(IDENTITY, true, false, 50, 20);
    expect(apply(m, 0, 0)).toEqual({ x: 50, y: 0 });
    expect(apply(m, 50, 20)).toEqual({ x: 0, y: 20 });
    expect(flipAffine(IDENTITY, false, false, 50, 20)).toBe(IDENTITY);
  });

  test("a child of a flipped, rotated frame lands at the mirrored spot", () => {
    const path = findNodePath(doc, "c")!;
    const m = nodeToDocAffine(doc, layout, path)!;
    // Child local (0, 0) sits at (10, 5) in the frame; mirrored: x = 50 - 10 = 40, y = 5. Then
    // rotation 90 (counter-clockwise on screen): (40, 5) -> (5, -40) from the frame's top-left.
    const p = apply(m, 0, 0);
    expect(p.x).toBeCloseTo(105);
    expect(p.y).toBeCloseTo(60);
  });

  test("ownFlip: false leaves the last node's mirror out", () => {
    const path = findNodePath(doc, "f")!;
    const withFlip = nodeToDocAffine(doc, layout, path)!;
    const without = nodeToDocAffine(doc, layout, path, false)!;
    expect(apply(without, 0, 0)).toEqual({ x: 100, y: 100 });
    expect(apply(withFlip, 0, 0).y).not.toBeCloseTo(100);
  });
});
