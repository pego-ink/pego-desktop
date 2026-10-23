import { describe, expect, test } from "bun:test";
import type { PegoNode } from "@pego/doc";
import { STAGGER_STEP, staggerChildrenOps } from "./stagger";

const frame = {
  type: "frame",
  id: "f",
  x: 0,
  y: 0,
  layout: "horizontal",
  children: [
    { type: "rectangle", id: "a", x: 0, y: 0 },
    { type: "rectangle", id: "hidden", x: 0, y: 0, visible: false },
    {
      type: "rectangle",
      id: "b",
      x: 0,
      y: 0,
      animation: { preset: "fade", duration: 900, easing: "linear" },
    },
  ],
} as PegoNode;

describe("staggerChildrenOps", () => {
  test("gives visible children the preset, one step apart", () => {
    expect(staggerChildrenOps(frame, "grow_up", 100)).toEqual([
      { op: "update", id: "a", props: { animation: { preset: "grow_up", delay: 100 } } },
      {
        op: "update",
        id: "b",
        props: {
          animation: {
            preset: "grow_up",
            delay: 100 + STAGGER_STEP,
            duration: 900,
            easing: "linear",
          },
        },
      },
    ]);
  });

  test("does nothing for a leaf", () => {
    expect(staggerChildrenOps({ type: "ellipse", id: "e", x: 0, y: 0 }, "fade")).toEqual([]);
  });
});
