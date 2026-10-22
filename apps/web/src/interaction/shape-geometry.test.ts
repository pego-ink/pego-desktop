import { describe, expect, test } from "bun:test";
import {
  fitToBox,
  polygonVertices,
  shapePath,
  shapePoints,
  starVertices,
  toPathData,
} from "./shape-geometry";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("polygonVertices", () => {
  test("triangle points up with three corners", () => {
    const v = polygonVertices(3);
    expect(v).toHaveLength(3);
    expect(close(v[0]!.x, 0) && close(v[0]!.y, -1)).toBe(true);
    expect(v[1]!.x).toBeGreaterThan(0);
    expect(v[2]!.x).toBeLessThan(0);
  });

  test("all vertices sit on the unit circle", () => {
    for (const p of polygonVertices(6)) expect(close(Math.hypot(p.x, p.y), 1)).toBe(true);
  });

  test("clamps to at least 3 sides", () => {
    expect(polygonVertices(1)).toHaveLength(3);
  });
});

describe("starVertices", () => {
  test("alternates tip and inner radius", () => {
    const v = starVertices(5, 0.38);
    expect(v).toHaveLength(10);
    v.forEach((p, i) => {
      expect(close(Math.hypot(p.x, p.y), i % 2 === 0 ? 1 : 0.38)).toBe(true);
    });
  });
});

describe("fitToBox", () => {
  test("bounding box fills the target exactly", () => {
    const pts = fitToBox(starVertices(5, 0.38), 200, 80);
    expect(close(Math.min(...pts.map((p) => p.x)), 0)).toBe(true);
    expect(close(Math.max(...pts.map((p) => p.x)), 200)).toBe(true);
    expect(close(Math.min(...pts.map((p) => p.y)), 0)).toBe(true);
    expect(close(Math.max(...pts.map((p) => p.y)), 80)).toBe(true);
  });

  test("triangle apex is centered on the top edge", () => {
    const [apex] = shapePoints("polygon", 100, 100);
    expect(apex!.x).toBeCloseTo(50, 6);
    expect(apex!.y).toBeCloseTo(0, 6);
  });
});

describe("path data", () => {
  test("is a closed polyline", () => {
    expect(
      toPathData([
        { x: 0, y: 0 },
        { x: 10.123, y: 5 },
        { x: 0, y: 5 },
      ]),
    ).toBe("M0 0 L10.12 5 L0 5 Z");
  });

  test("triangle path has 3 points, star path has 10", () => {
    expect(shapePath("polygon", 100, 100).match(/[ML]/g)).toHaveLength(3);
    expect(shapePath("star", 100, 100).match(/[ML]/g)).toHaveLength(10);
  });
});
