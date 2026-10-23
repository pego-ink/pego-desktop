import { describe, expect, test } from "bun:test";
import { sampleDoc, type PegoDocument } from "@pego/doc";
import { flattenLayers, layerLabel, rangeIds } from "./layer-rows";

const doc: PegoDocument = {
  version: 4,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "page",
      id: "page-1",
      name: "Page 1",
      x: 0,
      y: 0,
      children: [
        {
          type: "rectangle",
          id: "comp",
          name: "Button",
          reusable: true,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
        { type: "rectangle", id: "plain", x: 0, y: 0, width: 10, height: 10 },
        { type: "ref", id: "i1", ref: "comp", x: 0, y: 0 },
        { type: "ref", id: "i2", ref: "comp", name: "Primary", x: 0, y: 0 },
        { type: "ref", id: "i3", ref: "gone", x: 0, y: 0 },
      ],
    },
  ],
};

const label = (id: string) => {
  const node = doc.children[0]!.children.find((n) => n.id === id);
  if (!node) throw new Error(id);
  return layerLabel(doc, node);
};

describe("layerLabel", () => {
  test("unnamed non-ref falls back to its type", () => expect(label("plain")).toBe("rectangle"));
  test("own name wins", () => expect(label("comp")).toBe("Button"));
  test("unnamed ref shows the component name", () => expect(label("i1")).toBe("Button"));
  test("named ref keeps its own name", () => expect(label("i2")).toBe("Primary"));
  test("ref to a missing component is Instance", () => expect(label("i3")).toBe("Instance"));
});

describe("rows", () => {
  const hiddenFrame: PegoDocument = {
    ...sampleDoc,
    children: [
      {
        ...sampleDoc.children[0]!,
        children: sampleDoc.children[0]!.children.map((node) => ({ ...node, visible: false })),
      },
    ],
  };

  test("children of a hidden layer count as hidden too", () => {
    const rows = flattenLayers(hiddenFrame, new Set());
    expect(rows.map((row) => [row.node.id, row.hidden])).toEqual([
      ["frame-1", true],
      ["rect-1", true],
      ["text-1", true],
    ]);
    expect(flattenLayers(sampleDoc, new Set()).some((row) => row.hidden)).toBe(false);
  });

  test("shift-click selects the listed rows between the anchor and the row, either way", () => {
    const rows = flattenLayers(sampleDoc, new Set());
    expect(rangeIds(rows, "text-1", "frame-1")).toEqual(["frame-1", "rect-1", "text-1"]);
    expect(rangeIds(rows, "frame-1", "rect-1")).toEqual(["frame-1", "rect-1"]);
    expect(rangeIds(rows, null, "rect-1")).toEqual(["rect-1"]);
  });
});
