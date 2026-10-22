import { describe, expect, test } from "bun:test";
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
