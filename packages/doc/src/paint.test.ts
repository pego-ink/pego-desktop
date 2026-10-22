import { describe, expect, test } from "bun:test";
import { imageFitRect, linearGradientPoints } from "./paint";

const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 });

describe("linearGradientPoints", () => {
  test("180 runs top to bottom, 90 left to right", () => {
    const down = linearGradientPoints(180, 200, 100);
    expect([round(down.start), round(down.end)]).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const right = linearGradientPoints(90, 200, 100);
    expect([round(right.start), round(right.end)]).toEqual([
      { x: 0, y: 50 },
      { x: 200, y: 50 },
    ]);
  });

  test("diagonal gradients reach the corners like CSS", () => {
    // 45deg in a square: the line is the diagonal through the center.
    const { start, end } = linearGradientPoints(45, 100, 100);
    expect(round(start)).toEqual({ x: 0, y: 100 });
    expect(round(end)).toEqual({ x: 100, y: 0 });
  });
});

describe("imageFitRect", () => {
  test("cover crops, contain letterboxes, stretch fills", () => {
    expect(imageFitRect("cover", 200, 100, 100, 100)).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(imageFitRect("contain", 200, 100, 100, 100)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(imageFitRect("stretch", 200, 100, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });
});
