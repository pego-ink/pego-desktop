import { describe, expect, test } from "bun:test";
import { constrainAxis, handlePoint, hitHandle, moveOps, resizeBox, resizeOps } from "./transform";
import { fixtureDoc } from "./test-doc";

const box = { x: 100, y: 100, width: 200, height: 100 };

describe("resizeBox", () => {
  test("se grows from the top-left anchor", () =>
    expect(resizeBox(box, "se", 20, 10)).toEqual({ x: 100, y: 100, width: 220, height: 110 }));
  test("nw moves the origin", () =>
    expect(resizeBox(box, "nw", -20, -10)).toEqual({ x: 80, y: 90, width: 220, height: 110 }));
  test("e only changes width", () =>
    expect(resizeBox(box, "e", 50, 99)).toEqual({ x: 100, y: 100, width: 250, height: 100 }));
  test("min size is 1px", () => expect(resizeBox(box, "e", -1000, 0).width).toBe(1));
  test("shift keeps aspect ratio on corners", () => {
    const r = resizeBox(box, "se", 100, 0, { shift: true });
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.width).toBe(300);
  });
  test("shift on an edge scales the other axis around center", () =>
    expect(resizeBox(box, "e", 100, 0, { shift: true })).toEqual({
      x: 100,
      y: 75,
      width: 300,
      height: 150,
    }));
  test("alt resizes from center", () =>
    expect(resizeBox(box, "e", 10, 0, { alt: true })).toEqual({
      x: 90,
      y: 100,
      width: 220,
      height: 100,
    }));
});

describe("handles", () => {
  test("positions and hit-testing", () => {
    expect(handlePoint(box, "ne")).toEqual({ x: 300, y: 100 });
    expect(hitHandle(box, 301, 151, 6)).toBe("e");
    expect(hitHandle(box, 200, 150, 6)).toBeNull();
  });
});

describe("move/resize ops", () => {
  test("constrainAxis keeps the dominant axis", () => {
    expect(constrainAxis(10, 3)).toEqual({ dx: 10, dy: 0 });
    expect(constrainAxis(-2, 8)).toEqual({ dx: 0, dy: 8 });
  });
  test("move applies delta to each node's own x/y", () =>
    expect(moveOps(fixtureDoc, ["r1", "r2"], 5, -5)).toEqual([
      { op: "update", id: "r1", props: { x: 15, y: 5 } },
      { op: "update", id: "r2", props: { x: 55, y: 45 } },
    ]));
  test("flex children are skipped, selected descendants move with their ancestor", () => {
    expect(moveOps(fixtureDoc, ["flexchild"], 5, 5)).toEqual([]);
    expect(moveOps(fixtureDoc, ["f1", "r1"], 1, 1)).toEqual([
      { op: "update", id: "f1", props: { x: 1, y: 1 } },
    ]);
  });
  test("resize ops map absolute box delta onto relative x/y", () =>
    expect(
      resizeOps(
        fixtureDoc,
        "r1",
        { x: 10, y: 10, width: 100, height: 100 },
        { x: 0, y: 5, width: 110, height: 105 },
      ),
    ).toEqual([{ op: "update", id: "r1", props: { width: 110, height: 105, x: 0, y: 5 } }]));
});
