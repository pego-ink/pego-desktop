/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { sampleDoc, type Layout } from "@pego/doc";
import { CAPTION_GAP, CAPTION_HEIGHT } from "@/canvas/frame-captions";
import { pickOnCanvas } from "./pick-on-canvas";

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
