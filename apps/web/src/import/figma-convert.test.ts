/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { computeLayout, type FrameNode, type PegoDocument, type PegoNode } from "@pego/doc";
import { convertFigmaNodes, figmaColor, imageRefsOf, type FigmaNode } from "./figma-convert";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const black = { r: 0, g: 0, b: 0, a: 1 };

/** A card in Figma: vertical auto layout, a title (fill width) and a button (hug). */
const card: FigmaNode = {
  id: "1:2",
  name: "Card",
  type: "FRAME",
  absoluteBoundingBox: box(100, 200, 320, 160),
  layoutMode: "VERTICAL",
  itemSpacing: 12,
  paddingTop: 24,
  paddingRight: 24,
  paddingBottom: 24,
  paddingLeft: 24,
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "MIN",
  cornerRadius: 16,
  clipsContent: true,
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  effects: [
    {
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 0.12 },
      offset: { x: 0, y: 8 },
      radius: 24,
    },
  ],
  children: [
    {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      absoluteBoundingBox: box(124, 224, 272, 28),
      layoutSizingHorizontal: "FILL",
      textAutoResize: "HEIGHT",
      characters: "Pro plan",
      style: { fontFamily: "Inter", fontWeight: 600, fontSize: 20, lineHeightPx: 28 },
      fills: [{ type: "SOLID", color: { r: 0.07, g: 0.07, b: 0.1, a: 1 } }],
    },
    {
      id: "1:4",
      name: "Button",
      type: "FRAME",
      absoluteBoundingBox: box(124, 264, 120, 40),
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientHandlePositions: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
            { x: 0, y: 1 },
          ],
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
          ],
        },
      ],
      children: [],
    },
  ],
};

const asDoc = (nodes: PegoNode[]): PegoDocument => ({
  version: 8,
  id: "d",
  name: "d",
  variables: {},
  children: [{ type: "page", id: "p", name: "p", x: 0, y: 0, children: nodes }],
});

describe("figma import", () => {
  test("colors keep their alpha", () => {
    expect(figmaColor({ r: 1, g: 0.5, b: 0, a: 1 })).toBe("#ff8000");
    expect(figmaColor({ r: 0, g: 0, b: 0, a: 1 }, 0.5)).toBe("#00000080");
  });

  test("an auto layout frame becomes a flex frame with the same spacing and children", () => {
    const { nodes, warnings } = convertFigmaNodes([card]);
    expect(warnings).toEqual([]);
    const frame = nodes[0] as FrameNode;
    expect(frame).toMatchObject({
      type: "frame",
      name: "Card",
      x: 0,
      y: 0,
      width: 320,
      height: 160,
      layout: "vertical",
      gap: 12,
      padding: [24, 24, 24, 24],
      clip: true,
      cornerRadius: 16,
      fill: "#ffffff",
      effects: [{ type: "shadow", color: "#0000001f", x: 0, y: 8, blur: 24 }],
    });
    expect(frame.children[0]).toMatchObject({
      type: "text",
      content: "Pro plan",
      width: "fill_container",
      fontWeight: 600,
      lineHeight: 1.4,
      fill: "#12121a",
    });
    expect(frame.children[1]).toMatchObject({
      type: "frame",
      width: 120,
      height: 40,
      fill: { type: "linear", angle: 90, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] },
    });
    // Pego's own layout puts the button where Figma had it.
    const layout = computeLayout(asDoc(nodes), () => ({ width: 80, height: 28 }));
    expect(layout.get(frame.children[1]!.id)).toEqual({ x: 24, y: 64, width: 120, height: 40 });
  });

  test("an absolute layer inside auto layout keeps its place over the flow", () => {
    const badge: FigmaNode = {
      id: "1:9",
      name: "Badge",
      type: "ELLIPSE",
      absoluteBoundingBox: box(400, 192, 16, 16),
      layoutPositioning: "ABSOLUTE",
      layoutSizingHorizontal: "FILL",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    };
    const { nodes, warnings } = convertFigmaNodes([
      { ...card, children: [...(card.children ?? []), badge] },
    ]);
    expect(warnings).toEqual([]);
    const frame = nodes[0] as FrameNode;
    expect(frame.children[2]).toMatchObject({
      layoutPosition: "absolute",
      x: 300,
      y: -8,
      width: 16,
    });
    const layout = computeLayout(asDoc(nodes), () => ({ width: 80, height: 28 }));
    expect(layout.get(frame.children[2]!.id)).toEqual({ x: 300, y: -8, width: 16, height: 16 });
    // The flow is unchanged: the button is still under the title.
    expect(layout.get(frame.children[1]!.id)).toEqual({ x: 24, y: 64, width: 120, height: 40 });
  });

  test("groups, vectors, hidden layers, components and rotation", () => {
    const { nodes } = convertFigmaNodes([
      {
        id: "2:1",
        name: "Logo",
        type: "COMPONENT",
        absoluteBoundingBox: box(0, 0, 100, 100),
        children: [
          {
            id: "2:2",
            name: "Mark",
            type: "GROUP",
            absoluteBoundingBox: box(10, 10, 60, 60),
            children: [
              {
                id: "2:3",
                name: "Star",
                type: "STAR",
                absoluteBoundingBox: box(20, 20, 40, 40),
                fills: [{ type: "SOLID", color: black }],
                fillGeometry: [{ path: "M20 0L40 40L0 40Z" }],
              },
              {
                id: "2:4",
                name: "Ghost",
                type: "ELLIPSE",
                visible: false,
                absoluteBoundingBox: box(10, 10, 10, 10),
              },
            ],
          },
          {
            id: "2:5",
            name: "Tilted",
            type: "RECTANGLE",
            absoluteBoundingBox: box(0, 0, 20, 20),
            size: { x: 20, y: 20 },
            relativeTransform: [
              [0, 1, 0],
              [-1, 0, 20],
            ],
          },
        ],
      },
    ]);
    const logo = nodes[0] as FrameNode;
    expect(logo.reusable).toBe(true);
    const mark = logo.children[0] as FrameNode;
    expect(mark).toMatchObject({ type: "group", x: 10, y: 10 });
    expect(mark.children[0]).toMatchObject({
      type: "path",
      x: 10,
      y: 10,
      geometry: "M20 0L40 40L0 40Z",
      viewBox: [0, 0, 40, 40],
      fill: "#000000",
    });
    expect(mark.children[1]).toMatchObject({ type: "ellipse", visible: false });
    expect(logo.children[1]).toMatchObject({ type: "rectangle", rotation: 90, y: 20 });
  });

  test("image fills use the fetched data; what cannot be shown is a warning", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const photo: FigmaNode = {
      id: "3:1",
      name: "Photo",
      type: "RECTANGLE",
      absoluteBoundingBox: box(0, 0, 50, 50),
      fills: [{ type: "IMAGE", imageRef: "abc", scaleMode: "FIT" }],
    };
    expect(imageRefsOf([{ ...card, children: [photo] }])).toEqual(new Set(["abc"]));
    expect(convertFigmaNodes([photo], new Map([["abc", png]])).nodes[0]).toMatchObject({
      fill: { type: "image", src: png, fit: "contain" },
    });
    const missing = convertFigmaNodes([photo]);
    expect(missing.warnings).toContain("some image fills could not be embedded and were left out");
    const odd = convertFigmaNodes([
      { id: "4:1", type: "STICKY", absoluteBoundingBox: box(0, 0, 10, 10) },
    ]);
    expect(odd.nodes).toEqual([]);
    expect(odd.warnings).toEqual(["sticky layers are not supported"]);
  });

  test("children of a rotated frame are placed from their relative transform", () => {
    const { nodes } = convertFigmaNodes([
      {
        id: "7:1",
        type: "FRAME",
        absoluteBoundingBox: box(0, 0, 100, 100),
        size: { x: 60, y: 60 },
        relativeTransform: [
          [0.7071, -0.7071, 0],
          [0.7071, 0.7071, 0],
        ],
        children: [
          {
            id: "7:2",
            type: "RECTANGLE",
            // The axis-aligned box of the parent says 40, the transform says 10 / 20.
            absoluteBoundingBox: box(40, 40, 10, 10),
            size: { x: 10, y: 10 },
            relativeTransform: [
              [1, 0, 10],
              [0, 1, 20],
            ],
          },
        ],
      },
    ]);
    const frame = nodes[0] as FrameNode;
    expect(frame.children[0]).toMatchObject({ type: "rectangle", x: 10, y: 20 });
  });

  test("one invalid descendant drops only itself", () => {
    const { nodes, warnings } = convertFigmaNodes([
      {
        id: "8:1",
        type: "FRAME",
        absoluteBoundingBox: box(0, 0, 100, 100),
        children: [
          {
            id: "8:2",
            type: "RECTANGLE",
            absoluteBoundingBox: box(0, 0, 10, 10),
            // A gradient with one stop does not satisfy the schema (at least two).
            fills: [{ type: "GRADIENT_LINEAR", gradientStops: [{ color: black, position: 0 }] }],
          },
          { id: "8:3", type: "ELLIPSE", absoluteBoundingBox: box(0, 0, 10, 10) },
        ],
      },
    ]);
    const frame = nodes[0] as FrameNode;
    expect(frame).toBeDefined();
    expect(frame.children.some((child) => child.type === "ellipse")).toBe(true);
    expect(frame.children.some((child) => child.type === "rectangle")).toBe(false);
    expect(warnings).toContain("some layers did not fit Pego's format and were skipped");
  });

  test("silent losses are reported", () => {
    const { warnings } = convertFigmaNodes([
      {
        id: "9:1",
        type: "INSTANCE",
        absoluteBoundingBox: box(0, 0, 100, 100),
        strokes: [{ type: "SOLID", color: black }],
        strokeAlign: "INSIDE",
        children: [
          {
            id: "9:2",
            type: "GROUP",
            absoluteBoundingBox: box(0, 0, 10, 10),
            effects: [{ type: "LAYER_BLUR", radius: 4 }],
            children: [],
          },
          {
            id: "9:3",
            type: "VECTOR",
            absoluteBoundingBox: box(0, 0, 10, 10),
            strokes: [{ type: "SOLID", color: black }],
            strokeGeometry: [{ path: "M0 0L10 10" }],
            effects: [{ type: "LAYER_BLUR", radius: 4 }],
          },
        ],
      },
    ]);
    const text = warnings.join("\n");
    expect(text).toContain("instances became plain frames");
    expect(text).toContain("effects on groups were dropped");
    expect(text).toContain("effects on stroke-only vectors were dropped");
    expect(text).toContain("inside and outside strokes");
  });
});
