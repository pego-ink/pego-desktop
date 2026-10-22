import { describe, expect, test } from "bun:test";
import type { Camera } from "@/canvas/types";
import {
  CAMERA_DURATION_MS,
  createCameraAnimator,
  cubicBezier,
  interpolateCamera,
} from "./camera-animator";
import { screenToDoc } from "@/canvas/types";

const SIZE = { width: 1000, height: 600 };

/** Animator on a fake clock: `advance(ms)` runs the queued frame at each 16ms step. */
const setup = (start: Camera, reduced = false) => {
  let camera = start;
  let time = 0;
  let nextId = 1;
  let queued: { id: number; cb: () => void } | null = null;
  const animator = createCameraAnimator({
    getCamera: () => camera,
    getSize: () => SIZE,
    apply: (next) => {
      camera = next;
    },
    reducedMotion: () => reduced,
    now: () => time,
    raf: (cb) => {
      queued = { id: nextId++, cb };
      return queued.id;
    },
    caf: (id) => {
      if (queued?.id === id) queued = null;
    },
  });
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      time += 16;
      const job = queued;
      queued = null;
      job?.cb();
    }
  };
  return { animator, advance, camera: () => camera, pending: () => queued !== null };
};

describe("cubicBezier", () => {
  const ease = cubicBezier(0.77, 0, 0.175, 1);
  test("hits the endpoints and matches the CSS curve at 0.5", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.596, 2);
  });
  test("is monotonic and starts slow", () => {
    let last = 0;
    for (let i = 1; i <= 20; i++) {
      const v = ease(i / 20);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(ease(0.1)).toBeLessThan(0.1);
  });
});

describe("interpolateCamera", () => {
  const from: Camera = { zoom: 1, panX: 0, panY: 0 };
  const to: Camera = { zoom: 4, panX: -300, panY: -100 };
  test("endpoints", () => {
    expect(interpolateCamera(from, to, SIZE, 0)).toEqual(from);
    expect(interpolateCamera(from, to, SIZE, 1)).toEqual(to);
  });
  test("zoom is geometric and the view centre moves linearly in document space", () => {
    const mid = interpolateCamera(from, to, SIZE, 0.5);
    expect(mid.zoom).toBeCloseTo(2, 6);
    const a = screenToDoc(from, 500, 300);
    const b = screenToDoc(to, 500, 300);
    const c = screenToDoc(mid, 500, 300);
    expect(c.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(c.y).toBeCloseTo((a.y + b.y) / 2, 6);
  });
});

describe("tween", () => {
  const start: Camera = { zoom: 1, panX: 0, panY: 0 };
  const goal: Camera = { zoom: 2, panX: -200, panY: -50 };

  test("eases to the target over the duration, then stops asking for frames", () => {
    const { animator, advance, camera, pending } = setup(start);
    animator.animateTo(goal);
    advance(CAMERA_DURATION_MS / 2);
    expect(camera().zoom).toBeGreaterThan(1);
    expect(camera().zoom).toBeLessThan(2);
    advance(CAMERA_DURATION_MS);
    expect(camera()).toEqual(goal);
    expect(animator.isActive()).toBe(false);
    expect(pending()).toBe(false);
  });

  test("cancel freezes the camera where it is", () => {
    const { animator, advance, camera, pending } = setup(start);
    animator.animateTo(goal);
    advance(96);
    animator.cancel();
    const frozen = camera();
    advance(400);
    expect(camera()).toEqual(frozen);
    expect(pending()).toBe(false);
  });

  test("reduced motion jumps straight to the target", () => {
    const { animator, camera, pending } = setup(start, true);
    animator.animateTo(goal);
    expect(camera()).toEqual(goal);
    expect(pending()).toBe(false);
  });

  test("target() reports where the running tween is heading", () => {
    const { animator } = setup(start);
    expect(animator.target()).toEqual(start);
    animator.animateTo(goal);
    expect(animator.target()).toEqual(goal);
  });
});

describe("wheel chase", () => {
  const start: Camera = { zoom: 1, panX: 0, panY: 0 };

  test("one notch settles on the clamped factor around the cursor within ~150ms", () => {
    const { animator, advance, camera } = setup(start);
    const before = screenToDoc(start, 400, 250);
    animator.wheelZoomBy(1.2, 400, 250);
    advance(16);
    expect(camera().zoom).toBeGreaterThan(1);
    expect(camera().zoom).toBeLessThan(1.2);
    advance(250);
    expect(camera().zoom).toBeCloseTo(1.2, 3);
    const after = screenToDoc(camera(), 400, 250);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(animator.isActive()).toBe(false);
  });

  test("notches compound on the pending target", () => {
    const { animator, advance, camera } = setup(start);
    animator.wheelZoomBy(1.2, 0, 0);
    animator.wheelZoomBy(1.2, 0, 0);
    advance(400);
    expect(camera().zoom).toBeCloseTo(1.44, 3);
  });

  test("zoom stays within limits", () => {
    const { animator, advance, camera } = setup({ zoom: 63, panX: 0, panY: 0 });
    animator.wheelZoomBy(1.2, 0, 0);
    advance(600);
    expect(camera().zoom).toBeCloseTo(64, 3);
  });

  test("reduced motion applies the step at once", () => {
    const { animator, camera } = setup(start, true);
    animator.wheelZoomBy(1.2, 0, 0);
    expect(camera().zoom).toBeCloseTo(1.2, 6);
  });
});
