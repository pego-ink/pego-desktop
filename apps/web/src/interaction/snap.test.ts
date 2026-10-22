import { describe, expect, test } from "bun:test";
import { clickBox, drawBox } from "./create-node";
import { nudgeStep } from "./nudge";
import { roundPx } from "./snap";
import { fixtureDoc } from "./test-doc";
import { moveOps, nudgeOps, resizeBox, resizeOps } from "./transform";
import { wheelAction } from "./wheel-behavior";

describe("roundPx", () => {
  test("snap rounds to whole pixels", () => expect(roundPx(10.6, true)).toBe(11));
  test("no snap keeps 2 decimals", () => expect(roundPx(10.666, false)).toBe(10.67));
});

describe("snap in transforms", () => {
  const box = { x: 10, y: 10, width: 100, height: 100 };
  test("resizeBox snaps to integers", () => {
    const r = resizeBox(box, "se", 10.4, 20.6, { snap: true });
    expect(r).toEqual({ x: 10, y: 10, width: 110, height: 121 });
  });
  test("resizeBox without snap keeps fractions", () =>
    expect(resizeBox(box, "se", 10.4, 0).width).toBe(110.4));
  test("resizeBox snap keeps min size 1", () =>
    expect(resizeBox(box, "e", -1000, 0, { snap: true }).width).toBe(1));
  test("moveOps snaps the result", () => {
    const [op] = moveOps(fixtureDoc, ["r1"], 0.4, 0.6, true);
    expect(op).toEqual({ op: "update", id: "r1", props: { x: 10, y: 11 } });
  });
  test("moveOps without snap keeps fractions", () => {
    const [op] = moveOps(fixtureDoc, ["r1"], 0.4, 0.6);
    expect(op).toEqual({ op: "update", id: "r1", props: { x: 10.4, y: 10.6 } });
  });
  test("nudgeOps never snaps", () => {
    const [op] = nudgeOps(fixtureDoc, ["r1"], 0.5, 0);
    expect(op).toEqual({ op: "update", id: "r1", props: { x: 10.5, y: 10 } });
  });
  test("resizeOps snaps position", () => {
    const next = { x: 10.4, y: 10, width: 100, height: 100 };
    const [op] = resizeOps(fixtureDoc, "r1", { x: 10, y: 10, width: 100, height: 100 }, next, true);
    expect(op).toMatchObject({ props: { x: 10 } });
  });
});

describe("snap in create-node", () => {
  test("drawBox snaps when asked", () => {
    const box = drawBox({ x: 0.4, y: 0.4 }, { x: 10.7, y: 20.2 }, { snap: true });
    expect(box).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });
  test("drawBox without snap keeps fractions", () => {
    const box = drawBox({ x: 0.5, y: 0 }, { x: 10.25, y: 20 }, { snap: false });
    expect(box).toEqual({ x: 0.5, y: 0, width: 9.75, height: 20 });
  });
  test("clickBox honours snap", () => {
    expect(clickBox("rectangle", { x: 3.6, y: 4.4 }, true)).toMatchObject({ x: 4, y: 4 });
    expect(clickBox("rectangle", { x: 3.6, y: 4.4 }, false)).toMatchObject({ x: 3.6, y: 4.4 });
  });
});

describe("wheelAction", () => {
  const none = { ctrlKey: false, metaKey: false, shiftKey: false };
  test("pan mode pans, ctrl/meta zooms", () => {
    expect(wheelAction("pan", none)).toBe("pan");
    expect(wheelAction("pan", { ...none, ctrlKey: true })).toBe("zoom");
    expect(wheelAction("pan", { ...none, metaKey: true })).toBe("zoom");
  });
  test("zoom mode zooms, shift pans horizontally, ctrl still zooms", () => {
    expect(wheelAction("zoom", none)).toBe("zoom");
    expect(wheelAction("zoom", { ...none, shiftKey: true })).toBe("pan-horizontal");
    expect(wheelAction("zoom", { ...none, ctrlKey: true, shiftKey: true })).toBe("zoom");
  });
});

describe("nudgeStep", () => {
  const s = { nudgeSmall: 5, nudgeLarge: 25 };
  test("uses small without shift", () => expect(nudgeStep(false, s)).toBe(5));
  test("uses large with shift", () => expect(nudgeStep(true, s)).toBe(25));
});
