import { describe, expect, test } from "bun:test";
import type { Anchor, Contour } from "./anchors";
import {
  boundsOfContours,
  evalSegment,
  hitTestSegments,
  insertAnchorAt,
  nearestOnSegment,
  segmentsOf,
} from "./bezier";
import { pathGeometryProps } from "./build-node";
import { parseSvgPath } from "./svg-path";

const corner = (x: number, y: number): Anchor => ({ p: { x, y }, in: null, out: null });

describe("bounds", () => {
  test("polyline", () => {
    const c: Contour = { anchors: [corner(5, 5), corner(25, 10), corner(0, 40)], closed: false };
    expect(boundsOfContours([c])).toEqual({ minX: 0, minY: 5, maxX: 25, maxY: 40 });
  });
  test("curve extrema exceed the anchors", () => {
    const c = parseSvgPath("M0 0C0 20 10 20 10 0") ?? [];
    const r = boundsOfContours(c);
    expect(r?.maxY).toBeCloseTo(15);
    expect(r?.minY).toBe(0);
  });
  test("empty", () => {
    expect(boundsOfContours([])).toBeNull();
  });
});

describe("segments", () => {
  test("closed contour has a closing segment", () => {
    const c: Contour = { anchors: [corner(0, 0), corner(10, 0), corner(5, 8)], closed: true };
    expect(segmentsOf(c)).toHaveLength(3);
    expect(segmentsOf({ ...c, closed: false })).toHaveLength(2);
  });
  test("nearestOnSegment on a straight line", () => {
    const [s] = segmentsOf({ anchors: [corner(0, 0), corner(10, 0)], closed: false });
    const hit = nearestOnSegment(s!, { x: 4, y: 3 });
    expect(hit.point.x).toBeCloseTo(4, 2);
    expect(hit.distance).toBeCloseTo(3, 2);
  });
  test("hitTestSegments respects tolerance and picks the closest", () => {
    const c: Contour = { anchors: [corner(0, 0), corner(100, 0)], closed: false };
    expect(hitTestSegments([c], { x: 50, y: 4 }, 5)?.contour).toBe(0);
    expect(hitTestSegments([c], { x: 50, y: 9 }, 5)).toBeNull();
  });
});

describe("insertAnchorAt", () => {
  test("straight segment splits without handles", () => {
    const c: Contour = { anchors: [corner(0, 0), corner(10, 0)], closed: false };
    const r = insertAnchorAt(c, 0, 0.5);
    expect(r.index).toBe(1);
    expect(r.contour.anchors[1]).toEqual(corner(5, 0));
  });
  test("curved segment keeps the shape", () => {
    const c = parseSvgPath("M0 0C0 20 10 20 10 0")?.[0] as Contour;
    const before = segmentsOf(c)[0]!;
    const r = insertAnchorAt(c, 0, 0.3);
    const [left, right] = segmentsOf(r.contour);
    const mid = evalSegment(before, 0.3);
    expect(r.contour.anchors[1]?.p.x).toBeCloseTo(mid.x);
    expect(r.contour.anchors[1]?.p.y).toBeCloseTo(mid.y);
    const a = evalSegment(before, 0.15);
    const b = evalSegment(left!, 0.5);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
    const d = evalSegment(before, 0.65);
    const e = evalSegment(right!, 0.5);
    expect(e.x).toBeCloseTo(d.x);
    expect(e.y).toBeCloseTo(d.y);
  });
  test("closing segment appends the new anchor at the end", () => {
    const c: Contour = { anchors: [corner(0, 0), corner(10, 0), corner(5, 8)], closed: true };
    const r = insertAnchorAt(c, 2, 0.5);
    expect(r.index).toBe(3);
    expect(r.contour.anchors).toHaveLength(4);
  });
});

describe("pathGeometryProps", () => {
  const c: Contour = { anchors: [corner(110, 220), corner(150, 260)], closed: false };
  test("normalises geometry and offsets from the parent origin", () => {
    const p = pathGeometryProps([c], { x: 100, y: 200 }, false);
    expect(p).toEqual({ x: 10, y: 20, width: 40, height: 40, geometry: "M0 0L40 40" });
  });
  test("flex parents get no position; flat lines get size 1", () => {
    const flat: Contour = { anchors: [corner(0, 5), corner(10, 5)], closed: false };
    const p = pathGeometryProps([flat], { x: 0, y: 0 }, true);
    expect(p?.x).toBeUndefined();
    expect(p?.height).toBe(1);
  });
});
