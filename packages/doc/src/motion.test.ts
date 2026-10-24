import { describe, expect, test } from "bun:test";
import {
  EASING_CURVES,
  REST_FRAME,
  SLIDE_DISTANCE,
  countUpText,
  cubicBezier,
  motionEnd,
  motionFrame,
} from "./motion";
import type { PegoDocument } from "./schema";

describe("cubicBezier", () => {
  test("hits the ends and stays monotonic for ease_out", () => {
    const curve = EASING_CURVES.ease_out;
    expect(cubicBezier(curve, 0)).toBe(0);
    expect(cubicBezier(curve, 1)).toBe(1);
    let last = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      const y = cubicBezier(curve, t);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
    // Ease out: well ahead of linear halfway through.
    expect(cubicBezier(curve, 0.5)).toBeGreaterThan(0.8);
  });

  test("linear is the identity and spring overshoots", () => {
    expect(cubicBezier(EASING_CURVES.linear, 0.3)).toBeCloseTo(0.3, 5);
    const peak = Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => cubicBezier(EASING_CURVES.spring, t)));
    expect(peak).toBeGreaterThan(1);
  });
});

describe("motionFrame", () => {
  test("holds the start state during the delay and rests after the end", () => {
    const animation = { preset: "slide_up" as const, delay: 200, duration: 400 };
    expect(motionFrame(animation, 0)).toMatchObject({
      opacity: 0,
      dy: SLIDE_DISTANCE,
      progress: 0,
    });
    expect(motionFrame(animation, 200)).toMatchObject({ opacity: 0, dy: SLIDE_DISTANCE });
    expect(motionFrame(animation, 600)).toBe(REST_FRAME);
    const mid = motionFrame({ ...animation, easing: "linear" }, 400);
    expect(mid.opacity).toBeCloseTo(0.5, 5);
    expect(mid.dy).toBeCloseTo(SLIDE_DISTANCE / 2, 5);
  });

  test("grow_up scales from the bottom edge and grow_right from the left", () => {
    const up = motionFrame({ preset: "grow_up", duration: 100, easing: "linear" }, 25);
    expect(up).toMatchObject({ scaleX: 1, originY: 1, opacity: 1 });
    expect(up.scaleY).toBeCloseTo(0.25, 5);
    const right = motionFrame({ preset: "grow_right", duration: 100, easing: "linear" }, 50);
    expect(right).toMatchObject({ scaleY: 1, originX: 0 });
    expect(right.scaleX).toBeCloseTo(0.5, 5);
  });

  test("none only reports progress, for counting up", () => {
    const frame = motionFrame({ preset: "none", duration: 100, easing: "linear" }, 40);
    expect(frame).toMatchObject({ opacity: 1, dx: 0, dy: 0, scaleX: 1, scaleY: 1 });
    expect(frame.progress).toBeCloseTo(0.4, 5);
  });

  test("pop springs past full size", () => {
    const frames = [300, 360, 420, 480].map((t) => motionFrame({ preset: "pop" }, t).scaleX);
    expect(Math.max(...frames)).toBeGreaterThan(1);
  });
});

describe("countUpText", () => {
  test("scales every number and keeps the rest of the text", () => {
    expect(countUpText("70%", 0.5)).toBe("35%");
    expect(countUpText("± 6 bulan", 0)).toBe("± 0 bulan");
    expect(countUpText("0-21 hari", 0.5)).toBe("0-11 hari");
    expect(countUpText("no numbers", 0.5)).toBe("no numbers");
  });

  test("keeps decimals, the decimal mark and leading zeros", () => {
    expect(countUpText("1,2 kg", 0.5)).toBe("0,6 kg");
    expect(countUpText("3.75", 0.2)).toBe("0.75");
    expect(countUpText("05", 0.5)).toBe("03");
  });

  test("returns the content untouched once done", () => {
    expect(countUpText("70%", 1)).toBe("70%");
  });
});

describe("motionEnd", () => {
  const doc = (children: unknown[]): PegoDocument =>
    ({
      version: 8,
      id: "d",
      name: "D",
      variables: {},
      children: [{ type: "page", id: "p", x: 0, y: 0, children }],
    }) as PegoDocument;

  test("is the latest delay + duration, nested and in components", () => {
    const d = doc([
      { type: "rectangle", id: "a", x: 0, y: 0, animation: { preset: "fade", delay: 100 } },
      {
        type: "frame",
        id: "f",
        x: 0,
        y: 0,
        layout: "none",
        children: [
          {
            type: "text",
            id: "t",
            x: 0,
            y: 0,
            content: "1",
            animation: { preset: "fade", delay: 900, duration: 300 },
          },
        ],
      },
      {
        type: "rectangle",
        id: "h",
        x: 0,
        y: 0,
        visible: false,
        animation: { preset: "fade", delay: 9000 },
      },
    ]);
    expect(motionEnd(d, d.children[0]!.children)).toBe(1200);
  });

  test("is 0 without animations", () => {
    const d = doc([{ type: "rectangle", id: "a", x: 0, y: 0 }]);
    expect(motionEnd(d, d.children[0]!.children)).toBe(0);
  });
});
