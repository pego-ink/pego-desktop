/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { applyOps, sampleDoc, type Layout, type PegoNode } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { CAPTION_GAP, CAPTION_HEIGHT } from "@/canvas/frame-captions";
import { contextMenuTarget, pickOnCanvas } from "./pick-on-canvas";

const state = { doc: sampleDoc, selection: [], pageId: null };
const layout: Layout = new Map([["frame-1", { x: 0, y: 0, width: 800, height: 600 }]]);
const camera = { panX: 10, panY: 50, zoom: 0.5 };
/** The caption's row on screen, above the frame's top edge. */
const captionY = 50 - CAPTION_GAP - CAPTION_HEIGHT / 2;

describe("pickOnCanvas", () => {
  test("a frame's caption picks the frame (a right-click there opens its full menu)", () => {
    expect(pickOnCanvas(state, layout, camera, { x: 20, y: captionY }, false)).toBe("frame-1");
  });

  test("the frame's body picks as a click does, empty canvas picks nothing", () => {
    expect(pickOnCanvas(state, layout, camera, { x: 200, y: 200 }, false)).toBe("frame-1");
    expect(pickOnCanvas(state, layout, camera, { x: 20, y: captionY - 40 }, false)).toBeNull();
    expect(pickOnCanvas(state, layout, camera, { x: 700, y: captionY }, false)).toBeNull();
  });
});

describe("contextMenuTarget", () => {
  // frame-1 at 0..800 x 0..600 (rect-1 inside it at 80,120), a second frame at 1000..1200.
  const page = sampleDoc.children[0]!.id;
  const doc = applyOps(sampleDoc, [
    {
      op: "insert",
      parentId: page,
      node: {
        type: "frame",
        id: "frame-2",
        name: "Second",
        x: 1000,
        y: 0,
        width: 200,
        height: 200,
        layout: "none",
        children: [],
      } as PegoNode,
    },
  ]).doc;
  const docLayout = getLayout(doc);
  const flat = { panX: 0, panY: 60, zoom: 1 };
  const at = (x: number, y: number) => ({ x, y: y + 60 });
  const target = (selection: string[], x: number, y: number) =>
    contextMenuTarget({ doc, selection, pageId: null }, docLayout, flat, at(x, y), false);

  test("a layer inside the selection keeps the selection (the menu acts on it)", () => {
    expect(target(["frame-1"], 200, 200)).toEqual({ selection: ["frame-1"], empty: false });
  });

  test("another layer becomes the selection; a caption picks its frame", () => {
    // A click inside a top-level frame picks its child, as a left click does.
    expect(target(["frame-2"], 200, 200)).toEqual({ selection: ["rect-1"], empty: false });
    expect(target(["rect-1"], 10, -CAPTION_GAP - CAPTION_HEIGHT / 2)).toEqual({
      selection: ["frame-1"],
      empty: false,
    });
  });

  test("a miss inside the selection's bounds keeps it; outside, the selection clears", () => {
    const both = ["frame-1", "frame-2"];
    expect(target(both, 900, 100)).toEqual({ selection: both, empty: false });
    expect(target(both, 900, 800)).toEqual({ selection: [], empty: true });
    expect(target([], 900, 100)).toEqual({ selection: [], empty: true });
  });
});
