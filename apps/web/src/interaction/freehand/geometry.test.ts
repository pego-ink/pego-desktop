/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  buildFreehandPath,
  buildLinePath,
  cubicsToPathData,
  simplifyRdp,
  smoothToCubics,
  snapAngle45,
} from "./geometry";

describe("simplifyRdp", () => {
  test("collinear points collapse to the endpoints", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i * 2 }));
    expect(simplifyRdp(pts, 0.1)).toEqual([pts[0]!, pts[19]!]);
  });

  test("keeps a corner beyond the tolerance, drops it within", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 0 },
    ];
    expect(simplifyRdp(pts, 1)).toHaveLength(3);
    expect(simplifyRdp(pts, 4)).toHaveLength(2);
  });

  test("short inputs are returned as is", () => {
    expect(simplifyRdp([{ x: 1, y: 1 }], 5)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe("smoothToCubics", () => {
  test("one segment per gap, ending on each point", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const segs = smoothToCubics(pts);
    expect(segs).toHaveLength(2);
    expect(segs[1]!.to).toEqual({ x: 20, y: 0 });
    // First control point leans toward the next point: p1 + (p2 - p0) / 6.
    expect(segs[0]!.c1).toEqual({ x: 10 / 6, y: 10 / 6 });
  });

  test("path data is relative to the origin", () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ];
    expect(cubicsToPathData(pts[0]!, smoothToCubics(pts), pts[0]!)).toMatch(/^M0 0 C.* 10 0$/);
  });
});

describe("snapAngle45", () => {
  test("snaps near-horizontal to horizontal", () => {
    const end = snapAngle45({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(end.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(Math.hypot(100, 10));
  });

  test("snaps to the diagonal", () => {
    const end = snapAngle45({ x: 0, y: 0 }, { x: 50, y: 40 });
    expect(end.x).toBeCloseTo(end.y);
  });

  test("works in negative quadrants", () => {
    const end = snapAngle45({ x: 10, y: 10 }, { x: -40, y: 12 });
    expect(end.y).toBeCloseTo(10);
    expect(end.x).toBeLessThan(10);
  });
});

describe("path builders", () => {
  test("freehand path is normalized to its bounding box", () => {
    const shape = buildFreehandPath(
      [
        { x: 100, y: 50 },
        { x: 120, y: 70 },
        { x: 140, y: 50 },
      ],
      0.1,
    );
    expect(shape).toMatchObject({ x: 100, y: 50, width: 40, height: 20 });
    expect(shape?.geometry.startsWith("M0 0 C")).toBe(true);
  });

  test("shift (straight) keeps two points", () => {
    const shape = buildFreehandPath(
      [
        { x: 0, y: 0 },
        { x: 5, y: 9 },
        { x: 10, y: 0 },
      ],
      0.1,
      true,
    );
    expect(shape?.geometry).toBe("M0 0 L10 0");
  });

  test("a click without movement makes nothing", () => {
    expect(buildFreehandPath([{ x: 3, y: 3 }], 1)).toBeNull();
  });

  test("line path is relative to the node origin", () => {
    expect(buildLinePath({ x: 10, y: 20 }, { x: 110, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 0,
      geometry: "M0 0 L100 0",
    });
    expect(buildLinePath({ x: 50, y: 50 }, { x: 10, y: 20 }).geometry).toBe("M40 30 L0 0");
  });
});
