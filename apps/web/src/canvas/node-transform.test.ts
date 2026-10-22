import { describe, expect, test } from "bun:test";
import type { Layout, PegoDocument } from "@pego/doc";
import { findNodePath, IDENTITY, nodeToDocAffine, placeAffine } from "@/canvas/node-transform";

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
        id: "g",
        type: "group",
        rotation: 90,
        children: [{ id: "r", type: "rectangle", children: undefined }],
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
