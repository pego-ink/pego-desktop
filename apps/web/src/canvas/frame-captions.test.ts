/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { applyOps, sampleDoc, type Layout, type PegoNode } from "@pego/doc";
import { captionAt, CAPTION_GAP, CAPTION_HEIGHT, frameCaptions } from "./frame-captions";

const page = sampleDoc.children[0]!.id;
const doc = applyOps(sampleDoc, [
  {
    op: "insert",
    parentId: page,
    node: {
      type: "frame",
      id: "tiny",
      name: "Tiny",
      x: 900,
      y: 0,
      width: 10,
      height: 10,
      layout: "none",
      children: [],
    } as PegoNode,
  },
  {
    op: "insert",
    parentId: page,
    node: {
      type: "frame",
      id: "hidden",
      name: "Off",
      x: 900,
      y: 0,
      width: 200,
      height: 10,
      visible: false,
      layout: "none",
      children: [],
    } as PegoNode,
  },
  { op: "update", id: "frame-1", props: { reusable: true } },
  {
    op: "insert",
    parentId: page,
    node: { type: "ref", id: "inst", ref: "frame-1", x: 1200, y: 0 },
  },
  {
    op: "insert",
    parentId: page,
    node: { type: "text", id: "loose", x: 0, y: 900, content: "x" } as PegoNode,
  },
]).doc;
const layout: Layout = new Map([
  ["frame-1", { x: 0, y: 0, width: 800, height: 600 }],
  ["tiny", { x: 900, y: 0, width: 10, height: 10 }],
  ["hidden", { x: 900, y: 0, width: 200, height: 10 }],
  ["inst", { x: 1200, y: 0, width: 800, height: 600 }],
  ["loose", { x: 0, y: 900, width: 20, height: 20 }],
]);

describe("frame captions", () => {
  test("top-level frames and instances get their names above them, in screen space", () => {
    const captions = frameCaptions(doc, layout, { panX: 10, panY: 50, zoom: 0.5 }, null);
    expect(captions).toEqual([
      {
        id: "frame-1",
        text: "Frame",
        kind: "component",
        x: 10,
        y: 50 - CAPTION_GAP - CAPTION_HEIGHT,
        width: 400,
      },
      {
        id: "inst",
        text: "Frame",
        kind: "instance",
        x: 610,
        y: 50 - CAPTION_GAP - CAPTION_HEIGHT,
        width: 400,
      },
    ]);
  });

  test("a click on a caption picks its frame", () => {
    const captions = frameCaptions(doc, layout, { panX: 0, panY: 100, zoom: 1 }, null);
    expect(captionAt(captions, 5, 100 - CAPTION_GAP - 5)).toBe("frame-1");
    expect(captionAt(captions, 5, 100 + 5)).toBeNull();
    expect(captionAt(captions, 700, 100 - CAPTION_GAP - 5)).toBeNull();
  });
});
