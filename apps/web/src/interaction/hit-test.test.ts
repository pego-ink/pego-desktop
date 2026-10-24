import { describe, expect, test } from "bun:test";
import { computeLayout, type Layout, type PegoDocument, type PegoNode } from "@pego/doc";
import { hitPath } from "./hit-test";
import { fixtureDoc, fixtureLayout } from "./test-doc";

const hit = (x: number, y: number) => hitPath(fixtureDoc, fixtureLayout, x, y);

describe("hitPath", () => {
  test("empty canvas", () => expect(hit(500, 500)).toBeNull());
  test("frame background", () => expect(hit(300, 300)).toEqual(["f1"]));
  test("later sibling is on top", () => expect(hit(60, 60)).toEqual(["f1", "r2"]));
  test("earlier sibling where not covered", () => expect(hit(20, 20)).toEqual(["f1", "r1"]));
  test("clip hides children outside the frame", () => expect(hit(420, 420)).toBeNull());
  test("clipped child still hit inside the frame", () =>
    expect(hit(390, 390)).toEqual(["f1", "overflow"]));
  test("group has no area of its own", () => {
    expect(hit(5, 390)).toEqual(["f1"]);
    expect(hit(210, 210)).toEqual(["f1", "g1", "gr"]);
  });
  test("instance internals resolve to the instance root", () =>
    expect(hit(310, 20)).toEqual(["f1", "inst"]));
});

const makeDoc = (children: PegoNode[]): PegoDocument => ({
  version: 9,
  id: "d",
  name: "d",
  variables: {},
  children: [{ type: "page", id: "page-1", name: "Page 1", x: 0, y: 0, children }],
});

describe("hitPath with rotation", () => {
  // 100x50 rect at (100,100) rotated 90deg counter-clockwise around its top-left:
  // it covers doc x 100..150, y 0..100.
  const doc = makeDoc([
    { type: "rectangle", id: "rot", x: 100, y: 100, width: 100, height: 50, rotation: 90 },
  ]);
  const layout: Layout = new Map([["rot", { x: 100, y: 100, width: 100, height: 50 }]]);

  test("inside the rotated area but outside the unrotated box hits", () =>
    expect(hitPath(doc, layout, 125, 50)).toEqual(["rot"]));
  test("inside the unrotated box but outside the rotated area misses", () =>
    expect(hitPath(doc, layout, 180, 125)).toBeNull());
  test("rotation by 45 degrees hits along the rotated diagonal", () => {
    const d = makeDoc([
      { type: "rectangle", id: "r", x: 0, y: 0, width: 100, height: 10, rotation: 45 },
    ]);
    const l: Layout = new Map([["r", { x: 0, y: 0, width: 100, height: 10 }]]);
    expect(hitPath(d, l, 35, -30)).toEqual(["r"]);
    expect(hitPath(d, l, 35, 35)).toBeNull();
  });

  test("nested rotations accumulate", () => {
    const d = makeDoc([
      {
        type: "frame",
        id: "p",
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        layout: "none",
        rotation: 90,
        children: [
          { type: "rectangle", id: "c", x: 50, y: 0, width: 40, height: 20, rotation: 90 },
        ],
      },
    ]);
    const l: Layout = new Map([
      ["p", { x: 0, y: 0, width: 200, height: 200 }],
      ["c", { x: 50, y: 0, width: 40, height: 20 }],
    ]);
    expect(hitPath(d, l, -20, -60)).toEqual(["p", "c"]);
    // Inside the parent only: the child is not under this point.
    expect(hitPath(d, l, 10, -70)).toEqual(["p"]);
  });

  test("rotated clip frame clips children to the rotated box", () => {
    const build = (clip: boolean) =>
      makeDoc([
        {
          type: "frame",
          id: "f",
          x: 100,
          y: 100,
          width: 100,
          height: 50,
          layout: "none",
          clip,
          rotation: 90,
          children: [{ type: "rectangle", id: "c", x: 0, y: 0, width: 200, height: 200 }],
        },
      ]);
    const l: Layout = new Map([
      ["f", { x: 100, y: 100, width: 100, height: 50 }],
      ["c", { x: 100, y: 100, width: 200, height: 200 }],
    ]);
    expect(hitPath(build(true), l, 125, 50)).toEqual(["f", "c"]);
    expect(hitPath(build(true), l, 160, 70)).toBeNull();
    expect(hitPath(build(false), l, 160, 70)).toEqual(["f", "c"]);
  });
});

describe("hitPath tolerance for thin paths", () => {
  const line = (stroke?: { color: string; width: number }): PegoNode[] => [
    {
      type: "path",
      id: "line",
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      geometry: "M0 0 L200 0",
      ...(stroke ? { stroke } : {}),
    },
  ];
  const layout: Layout = new Map([["line", { x: 100, y: 100, width: 200, height: 0 }]]);

  test("a zero-height line is missed without tolerance off the exact row", () => {
    const doc = makeDoc(line());
    expect(hitPath(doc, layout, 200, 103)).toBeNull();
  });
  test("tolerance makes a horizontal line clickable nearby", () => {
    const doc = makeDoc(line());
    expect(hitPath(doc, layout, 200, 103, { tolerance: 4 })).toEqual(["line"]);
    expect(hitPath(doc, layout, 200, 96, { tolerance: 4 })).toEqual(["line"]);
    expect(hitPath(doc, layout, 200, 110, { tolerance: 4 })).toBeNull();
  });
  test("tolerance reaches past the ends of the line", () => {
    const doc = makeDoc(line());
    expect(hitPath(doc, layout, 97, 100, { tolerance: 4 })).toEqual(["line"]);
    expect(hitPath(doc, layout, 90, 100, { tolerance: 4 })).toBeNull();
  });
  test("stroke width widens the target", () => {
    const doc = makeDoc(line({ color: "#fff", width: 10 }));
    expect(hitPath(doc, layout, 200, 108, { tolerance: 4 })).toEqual(["line"]);
    expect(hitPath(doc, layout, 200, 110, { tolerance: 4 })).toBeNull();
  });
  test("a vertical line works the same", () => {
    const doc = makeDoc([
      { type: "path", id: "v", x: 50, y: 50, width: 0, height: 120, geometry: "M0 0 L0 120" },
    ]);
    const l: Layout = new Map([["v", { x: 50, y: 50, width: 0, height: 120 }]]);
    expect(hitPath(doc, l, 53, 100, { tolerance: 4 })).toEqual(["v"]);
    expect(hitPath(doc, l, 60, 100, { tolerance: 4 })).toBeNull();
  });
  test("non-path nodes keep their exact box", () => {
    const doc = makeDoc([{ type: "rectangle", id: "r", x: 0, y: 0, width: 10, height: 10 }]);
    const l: Layout = new Map([["r", { x: 0, y: 0, width: 10, height: 10 }]]);
    expect(hitPath(doc, l, 12, 5, { tolerance: 4 })).toBeNull();
  });
});

describe("hitPath with flip", () => {
  const doc = makeDoc([
    {
      type: "frame",
      id: "fr",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      layout: "none",
      flipX: true,
      children: [{ type: "rectangle", id: "c", x: 10, y: 10, width: 20, height: 20 }],
    },
  ]);
  const layout: Layout = new Map([
    ["fr", { x: 0, y: 0, width: 200, height: 100 }],
    ["c", { x: 10, y: 10, width: 20, height: 20 }],
  ]);

  test("a child is picked at its mirrored position", () => {
    expect(hitPath(doc, layout, 180, 20)).toEqual(["fr", "c"]);
    expect(hitPath(doc, layout, 20, 20)).toEqual(["fr"]);
  });
  test("the flipped node's own box does not move", () =>
    expect(hitPath(doc, layout, 100, 90)).toEqual(["fr"]));
});

describe("hitPath on connectors", () => {
  const doc = makeDoc([
    { type: "frame", id: "a", x: 0, y: 0, width: 100, height: 200, layout: "none", children: [] },
    {
      type: "frame",
      id: "b",
      x: 300,
      y: 300,
      width: 100,
      height: 200,
      layout: "none",
      children: [],
    },
    { type: "connector", id: "c", x: 0, y: 0, from: { id: "a" }, to: { id: "b" }, label: "Tap" },
  ]);
  const layout = computeLayout(doc, () => ({ width: 0, height: 0 }));

  test("near the elbow line it is hit; inside its box away from the line it is not", () => {
    // Elbow: (100,100) -> (200,100) -> (200,400) -> (300,400).
    expect(hitPath(doc, layout, 150, 102, { tolerance: 4 })).toEqual(["c"]);
    expect(hitPath(doc, layout, 202, 330, { tolerance: 4 })).toEqual(["c"]);
    expect(hitPath(doc, layout, 150, 300, { tolerance: 4 })).toBeNull();
  });

  test("its label is a target too", () => {
    // Midpoint of the line is (200, 250); the label pill reaches a little to the side.
    expect(hitPath(doc, layout, 210, 252, { tolerance: 4 })).toEqual(["c"]);
  });
});
