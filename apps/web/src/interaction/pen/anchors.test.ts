import { describe, expect, test } from "bun:test";
import {
  canClose,
  constrain45,
  creationDrag,
  dragHandle,
  isSmooth,
  mirror,
  removeAnchor,
  toggleSmooth,
  type Anchor,
  type Contour,
} from "./anchors";

const corner = (x: number, y: number): Anchor => ({ p: { x, y }, in: null, out: null });

describe("constrain45", () => {
  test("snaps near-horizontal to horizontal", () => {
    const r = constrain45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(r.x).toBeCloseTo(Math.hypot(10, 1));
    expect(r.y).toBeCloseTo(0);
  });
  test("snaps to the diagonal keeping length", () => {
    const r = constrain45({ x: 5, y: 5 }, { x: 15, y: 12 });
    expect(r.x - 5).toBeCloseTo(r.y - 5);
    expect(Math.hypot(r.x - 5, r.y - 5)).toBeCloseTo(Math.hypot(10, 7));
  });
  test("zero length returns the target", () => {
    expect(constrain45({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});

describe("handles", () => {
  test("mirror", () => {
    expect(mirror({ x: 10, y: 10 }, { x: 14, y: 7 })).toEqual({ x: 6, y: 13 });
  });
  test("creationDrag mirrors unless alt", () => {
    const a = corner(10, 10);
    expect(creationDrag(a, { x: 20, y: 10 }, false).in).toEqual({ x: 0, y: 10 });
    expect(creationDrag(a, { x: 20, y: 10 }, true).in).toBeNull();
  });
  test("isSmooth", () => {
    expect(isSmooth({ p: { x: 0, y: 0 }, in: { x: -5, y: 0 }, out: { x: 8, y: 0 } })).toBe(true);
    expect(isSmooth({ p: { x: 0, y: 0 }, in: { x: -5, y: 0 }, out: { x: 0, y: 8 } })).toBe(false);
    expect(isSmooth(corner(0, 0))).toBe(false);
  });
  test("dragging a smooth handle rotates the opposite one and keeps its length", () => {
    const a: Anchor = { p: { x: 0, y: 0 }, in: { x: -5, y: 0 }, out: { x: 10, y: 0 } };
    const r = dragHandle(a, "out", { x: 0, y: 10 }, false);
    expect(r.out).toEqual({ x: 0, y: 10 });
    expect(r.in?.x).toBeCloseTo(0);
    expect(r.in?.y).toBeCloseTo(-5);
  });
  test("alt leaves the opposite handle alone", () => {
    const a: Anchor = { p: { x: 0, y: 0 }, in: { x: -5, y: 0 }, out: { x: 10, y: 0 } };
    expect(dragHandle(a, "out", { x: 0, y: 10 }, true).in).toEqual({ x: -5, y: 0 });
  });
});

describe("contour edits", () => {
  const open: Contour = { anchors: [corner(0, 0), corner(10, 0), corner(20, 10)], closed: false };
  test("toggleSmooth makes a corner smooth and back", () => {
    const smooth = toggleSmooth(open, 1);
    const a = smooth.anchors[1] as Anchor;
    expect(isSmooth(a)).toBe(true);
    expect(toggleSmooth(smooth, 1).anchors[1]).toEqual(corner(10, 0));
  });
  test("toggleSmooth at an open end only creates one handle", () => {
    const a = toggleSmooth(open, 0).anchors[0] as Anchor;
    expect(a.in).toBeNull();
    expect(a.out).not.toBeNull();
  });
  test("removeAnchor opens a closed triangle", () => {
    const tri: Contour = { anchors: [corner(0, 0), corner(10, 0), corner(5, 8)], closed: true };
    const r = removeAnchor(tri, 2);
    expect(r.anchors).toHaveLength(2);
    expect(r.closed).toBe(false);
    expect(removeAnchor({ ...tri, anchors: [...tri.anchors, corner(0, 9)] }, 0).closed).toBe(true);
  });
  test("canClose needs 2+ anchors and proximity to the first", () => {
    expect(canClose(open, { x: 1, y: 1 }, 3)).toBe(true);
    expect(canClose(open, { x: 5, y: 5 }, 3)).toBe(false);
    expect(canClose({ anchors: [corner(0, 0)], closed: false }, { x: 0, y: 0 }, 3)).toBe(false);
    expect(canClose({ ...open, closed: true }, { x: 0, y: 0 }, 3)).toBe(false);
  });
});
