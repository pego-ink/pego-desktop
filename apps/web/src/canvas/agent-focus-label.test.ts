/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { boundsOfPoints, cursorRect, placeGeneratingLabel } from "./agent-focus-label";

const size = { width: 80, height: 20 };

describe("boundsOfPoints", () => {
  test("bounds rotated corners", () => {
    expect(
      boundsOfPoints([
        { x: 10, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 20 },
        { x: 0, y: 10 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 20, height: 20 });
    expect(boundsOfPoints([])).toBeNull();
  });
});

describe("placeGeneratingLabel", () => {
  const union = { x: 100, y: 200, width: 300, height: 200 };

  test("sits above the top-left of the union", () => {
    expect(placeGeneratingLabel(union, size, [])).toEqual({ x: 100, y: 176 });
  });

  test("lifts above a colliding cursor and ignores distant ones", () => {
    const near = { x: 110, y: 170, width: 90, height: 40 };
    const far = { x: 600, y: 170, width: 90, height: 40 };
    expect(placeGeneratingLabel(union, size, [far])).toEqual({ x: 100, y: 176 });
    expect(placeGeneratingLabel(union, size, [near])).toEqual({ x: 100, y: 146 });
  });

  test("stays inside the canvas edge", () => {
    expect(placeGeneratingLabel({ x: -50, y: 5, width: 10, height: 10 }, size, [])).toEqual({
      x: 4,
      y: 4,
    });
  });
});

describe("cursorRect", () => {
  test("covers the pill on the right, or on the left when flipped", () => {
    expect(cursorRect({ x: 100, y: 50 }, 40, false)).toEqual({
      x: 100,
      y: 50,
      width: 54,
      height: 40,
    });
    expect(cursorRect({ x: 100, y: 50 }, 40, true)).toEqual({
      x: 70,
      y: 50,
      width: 50,
      height: 40,
    });
  });
});
