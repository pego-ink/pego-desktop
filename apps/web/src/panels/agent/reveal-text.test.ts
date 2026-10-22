import { describe, expect, it } from "bun:test";
import {
  COLLAPSE_MAX_PX,
  REVEAL_MAX_MS,
  REVEAL_MIN_MS,
  countWords,
  revealAdvance,
  revealDurationMs,
  revealRate,
  revealTarget,
  shouldCollapse,
  visibleHeight,
} from "@/panels/agent/reveal-text";

describe("reveal timing", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  halo  dunia\n baru ")).toBe(3);
  });
  it("uses ~25ms per word", () => {
    expect(revealDurationMs(20)).toBe(500);
  });
  it("clamps short and long texts", () => {
    expect(revealDurationMs(1)).toBe(REVEAL_MIN_MS);
    expect(revealDurationMs(5000)).toBe(REVEAL_MAX_MS);
    expect(revealDurationMs(36)).toBe(REVEAL_MAX_MS);
  });
  it("advances at a constant rate and stops at the target", () => {
    const rate = revealRate(500, 500);
    expect(rate).toBe(1);
    expect(revealAdvance(0, 500, 16, rate)).toBe(16);
    expect(revealAdvance(490, 500, 50, rate)).toBe(500);
    expect(revealAdvance(10, 500, -5, rate)).toBe(10);
  });
  it("covers the full distance in the duration", () => {
    const target = revealTarget(100);
    const rate = revealRate(target, 400);
    expect(revealAdvance(0, target, 400, rate)).toBe(target);
  });
});

describe("collapse threshold", () => {
  it("keeps up to ~8 lines (plus slack) open", () => {
    expect(shouldCollapse(COLLAPSE_MAX_PX)).toBe(false);
    expect(shouldCollapse(COLLAPSE_MAX_PX + 20)).toBe(false);
    expect(shouldCollapse(COLLAPSE_MAX_PX + 40)).toBe(false);
  });
  it("collapses beyond that", () => {
    expect(shouldCollapse(COLLAPSE_MAX_PX + 41)).toBe(true);
    expect(shouldCollapse(600)).toBe(true);
  });
});

describe("visibleHeight", () => {
  it("clips a folded reply to its first lines", () => {
    expect(visibleHeight(600, false)).toBe(COLLAPSE_MAX_PX);
  });
  it("shows everything when expanded or short", () => {
    expect(visibleHeight(600, true)).toBe(600);
    expect(visibleHeight(100, false)).toBe(100);
  });
});
