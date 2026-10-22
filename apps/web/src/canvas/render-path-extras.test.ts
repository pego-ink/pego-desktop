/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { markerShape, markerSize } from "./render-path-extras";

const tip = { x: 100, y: 50 };
const east = { x: 1, y: 0 };

describe("markerShape", () => {
  test("none draws nothing", () => {
    expect(markerShape("none", tip, east, 2)).toBeNull();
  });

  test("arrow is an open chevron behind the tip, symmetric about the direction", () => {
    const shape = markerShape("arrow", tip, east, 2);
    if (shape?.kind !== "polyline") throw new Error("expected polyline");
    const [a, mid, b] = shape.points;
    expect(mid).toEqual(tip);
    expect(a!.x).toBeLessThan(tip.x);
    expect(a!.x).toBeCloseTo(b!.x);
    expect(a!.y - tip.y).toBeCloseTo(-(b!.y - tip.y));
    expect(Math.hypot(a!.x - tip.x, a!.y - tip.y)).toBeCloseTo(markerSize(2));
  });

  test("orientation follows the tangent", () => {
    const shape = markerShape("triangle", tip, { x: 0, y: 1 }, 2);
    if (shape?.kind !== "polygon") throw new Error("expected polygon");
    expect(shape.points[0]).toEqual(tip);
    expect(shape.points[1]!.y).toBeLessThan(tip.y);
    expect(shape.points[1]!.y).toBeCloseTo(shape.points[2]!.y);
  });

  test("bar is perpendicular to the direction and centered on the tip", () => {
    const shape = markerShape("bar", tip, east, 2);
    if (shape?.kind !== "polyline") throw new Error("expected polyline");
    const [a, b] = shape.points;
    expect(a!.x).toBeCloseTo(tip.x);
    expect(b!.x).toBeCloseTo(tip.x);
    expect((a!.y + b!.y) / 2).toBeCloseTo(tip.y);
  });

  test("circle is centered on the tip and grows with the stroke", () => {
    const small = markerShape("circle", tip, east, 2);
    const big = markerShape("circle", tip, east, 10);
    if (small?.kind !== "circle" || big?.kind !== "circle") throw new Error("expected circle");
    expect([small.cx, small.cy]).toEqual([tip.x, tip.y]);
    expect(big.r).toBeGreaterThan(small.r);
  });
});
