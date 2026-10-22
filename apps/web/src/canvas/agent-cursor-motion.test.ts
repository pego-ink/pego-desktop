/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  clampToSize,
  createGlide,
  curvePoint,
  driftOffset,
  easeOut,
  glideAt,
  glideDuration,
  isCursorActive,
  pickInspectAnchor,
  pickTargetAnchor,
  pickWanderPoint,
  pointInRect,
  seeded,
  unionRect,
} from "./agent-cursor-motion";

describe("isCursorActive", () => {
  test("active statuses are always active", () => {
    for (const s of ["planning", "running", "awaiting_decision"])
      expect(isCursorActive(s, null, 10_000)).toBe(true);
  });
  test("idle counts only with recent log activity", () => {
    expect(isCursorActive("idle", 9000, 10_000)).toBe(true);
    expect(isCursorActive("idle", 5000, 10_000)).toBe(false);
    expect(isCursorActive("idle", null, 10_000)).toBe(false);
  });
  test("finished runs are inactive", () => {
    expect(isCursorActive("done", 9999, 10_000)).toBe(false);
  });
});

describe("easing and duration", () => {
  test("easeOut is 0 to 1 and monotonic", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeOut(0.6)).toBeGreaterThan(easeOut(0.5));
  });
  test("glideDuration stays within 400-700ms", () => {
    expect(glideDuration(0)).toBe(400);
    expect(glideDuration(100000)).toBe(700);
    expect(glideDuration(400)).toBeGreaterThan(400);
  });
});

describe("curve and glide", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  test("curve hits both endpoints", () => {
    expect(curvePoint(a, b, 0, 0.2)).toEqual(a);
    expect(curvePoint(a, b, 1, 0.2)).toEqual(b);
  });
  test("curve bends off the straight line", () => {
    const mid = curvePoint(a, b, 0.5, 0.2);
    expect(Math.abs(mid.y)).toBeGreaterThan(1);
    expect(curvePoint(a, b, 0.5, 0).y).toBe(0);
  });
  test("glideAt finishes exactly on target", () => {
    const g = createGlide(a, b, 1000, 1, 1);
    expect(glideAt(g, b, 1000).point).toEqual(a);
    expect(glideAt(g, b, 1000).done).toBe(false);
    const end = glideAt(g, b, 1000 + g.duration);
    expect(end).toEqual({ point: b, done: true });
  });
  test("glide tracks a moving target", () => {
    const g = createGlide(a, b, 0, 1, 1);
    const moved = { x: 200, y: 50 };
    expect(glideAt(g, moved, g.duration + 1).point).toEqual(moved);
  });
});

describe("target selection", () => {
  const rect = { x: 100, y: 200, width: 400, height: 300 };
  test("unionRect", () => {
    expect(unionRect([])).toBeNull();
    expect(
      unionRect([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 30, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });
  test("target anchor is deterministic, upper-left and inside", () => {
    const a = pickTargetAnchor("rect-1");
    expect(a).toEqual(pickTargetAnchor("rect-1"));
    expect(a.fx).toBeGreaterThanOrEqual(0.12);
    expect(a.fx).toBeLessThanOrEqual(0.46);
    expect(a.fy).toBeLessThanOrEqual(0.42);
    expect(pickTargetAnchor("rect-2")).not.toEqual(a);
    const p = pointInRect(rect, a);
    expect(p.x).toBeGreaterThan(rect.x);
    expect(p.x).toBeLessThan(rect.x + rect.width);
  });
  test("inspect anchors stay on the unit box and vary by step", () => {
    const seen = new Set<string>();
    for (let step = 0; step < 12; step++) {
      const { fx, fy } = pickInspectAnchor("k", step);
      expect(fx).toBeGreaterThanOrEqual(0);
      expect(fx).toBeLessThanOrEqual(1);
      expect(fy).toBeGreaterThanOrEqual(0);
      expect(fy).toBeLessThanOrEqual(1);
      seen.add(`${fx.toFixed(2)},${fy.toFixed(2)}`);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
  test("wander stays near the viewport center/top", () => {
    const size = { width: 1000, height: 800 };
    for (let step = 0; step < 20; step++) {
      const p = pickWanderPoint(size, step);
      expect(p.x).toBeGreaterThan(300);
      expect(p.x).toBeLessThan(700);
      expect(p.y).toBeLessThan(400);
    }
  });
  test("clampToSize keeps the tip visible", () => {
    expect(clampToSize({ x: -50, y: 9999 }, { width: 500, height: 400 })).toEqual({
      x: 20,
      y: 380,
    });
  });
});

describe("drift and seeded", () => {
  test("drift is small and moves over time", () => {
    const a = driftOffset(0, 5);
    const b = driftOffset(1500, 5);
    expect(Math.hypot(a.x, a.y)).toBeLessThan(4);
    expect(a).not.toEqual(b);
  });
  test("seeded is in [0, 1) and deterministic", () => {
    for (let i = 0; i < 50; i++) {
      const v = seeded(123, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(seeded(123, i));
    }
  });
});
