import { describe, expect, test } from "bun:test";
import type { Layout, PegoDocument } from "@pego/doc";
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

const makeDoc = (children: PegoDocument["children"]): PegoDocument => ({
  version: 0,
  id: "d",
  name: "d",
  variables: {},
  children,
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
