import { describe, expect, test } from "bun:test";
import { applyOps, computeLayout, findNode, type PegoDocument, type PegoNode } from "@pego/doc";
import { flipOps, flippableIds, mirrorShift, normalizeAngle } from "./flip-ops";

const doc: PegoDocument = {
  version: 8,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "page",
      id: "page-1",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        { type: "rectangle", id: "a", x: 0, y: 0, width: 20, height: 10 },
        { type: "rectangle", id: "b", x: 80, y: 40, width: 20, height: 10, flipX: true },
        {
          type: "frame",
          id: "flex",
          x: 200,
          y: 0,
          width: 100,
          height: 100,
          layout: "horizontal",
          children: [{ type: "rectangle", id: "kid", x: 0, y: 0, width: 10, height: 10 }],
        },
      ],
    },
  ],
};
const layout = computeLayout(doc, () => ({ width: 10, height: 10 }));
const flagOf = (d: PegoDocument, id: string, key: "flipX" | "flipY") =>
  (findNode(d, id) as PegoNode & Record<string, unknown>)[key];

describe("mirrorShift", () => {
  test("moves a span to its mirror inside the bounds", () => {
    expect(mirrorShift(0, 100, 0, 20)).toBe(80);
    expect(mirrorShift(0, 100, 80, 100)).toBe(-80);
    expect(mirrorShift(0, 100, 40, 60)).toBe(0);
  });
});

describe("flipOps", () => {
  test("toggles one node without moving it", () => {
    const ops = flipOps(doc, layout, ["a"], "x");
    expect(ops).toEqual([{ op: "update", id: "a", props: { flipX: true } }]);
    expect(flagOf(applyOps(doc, ops).doc, "a", "flipX")).toBe(true);
  });

  test("a second flip removes the prop", () => {
    const next = applyOps(doc, flipOps(doc, layout, ["b"], "x")).doc;
    expect(flagOf(next, "b", "flipX")).toBeUndefined();
  });

  test("axes are independent", () => {
    const ops = flipOps(doc, layout, ["a"], "y");
    expect(ops[0]).toMatchObject({ props: { flipY: true } });
  });

  test("a multi-selection mirrors positions inside its bounds", () => {
    const ops = flipOps(doc, layout, ["a", "b"], "x");
    const next = applyOps(doc, ops).doc;
    // bounds x 0..100: a (0..20) goes to 80, b (80..100) goes to 0; y is untouched
    expect(findNode(next, "a")).toMatchObject({ x: 80, y: 0, flipX: true });
    expect(findNode(next, "b")).toMatchObject({ x: 0, y: 40 });
    expect(flagOf(next, "b", "flipX")).toBeUndefined();
  });

  test("vertical multi-flip moves y only", () => {
    const next = applyOps(doc, flipOps(doc, layout, ["a", "b"], "y")).doc;
    expect(findNode(next, "a")).toMatchObject({ x: 0, y: 40, flipY: true });
    expect(findNode(next, "b")).toMatchObject({ x: 80, y: 0, flipY: true });
  });

  test("flex children keep their slot", () => {
    const ops = flipOps(doc, layout, ["a", "kid"], "x");
    const kid = ops.find((op) => op.op === "update" && op.id === "kid");
    expect(kid).toEqual({ op: "update", id: "kid", props: { flipX: true } });
  });

  test("pages and instance-internal ids are skipped", () => {
    expect(flippableIds(doc, ["page-1", "a/inner", "a"])).toEqual(["a"]);
    expect(flipOps(doc, layout, ["page-1"], "x")).toEqual([]);
  });

  test("a child of a selected frame is not flipped twice", () => {
    expect(flippableIds(doc, ["flex", "kid"])).toEqual(["flex"]);
  });
});

describe("flip of a rotated layer", () => {
  const rotated: PegoDocument = {
    ...doc,
    children: [
      {
        type: "page",
        id: "page-1",
        name: "Page 1",
        x: 0,
        y: 0,
        children: [
          {
            type: "path",
            id: "arrow",
            x: 0,
            y: 0,
            geometry: "M0 0 L20 5 L0 10 Z",
            width: 20,
            height: 10,
            rotation: 30,
          },
        ],
      },
    ],
  };
  const rotatedLayout = computeLayout(rotated, () => ({ width: 10, height: 10 }));

  test("negates the rotation so the result is a visual mirror (30° arrow → 150°, not 210°)", () => {
    expect(flipOps(rotated, rotatedLayout, ["arrow"], "x")).toEqual([
      { op: "update", id: "arrow", props: { flipX: true, rotation: -30 } },
    ]);
    expect(flipOps(rotated, rotatedLayout, ["arrow"], "y")[0]).toMatchObject({
      props: { flipY: true, rotation: -30 },
    });
  });

  test("normalizeAngle folds into (-180, 180]", () => {
    expect(normalizeAngle(-30)).toBe(-30);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-0)).toBe(0);
  });
});
