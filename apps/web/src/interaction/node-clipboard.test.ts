/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  findLocation,
  findNode,
  sampleDoc,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import {
  copyPayload,
  PASTE_OFFSET,
  pasteNodes,
  pasteSvg,
  pasteText,
  readPayload,
  type PastePlan,
} from "./node-clipboard";

const page = sampleDoc.children[0]!.id;
const target = { pageId: page, selection: [] as string[], center: { x: 1000, y: 500 } };

const apply = (doc: PegoDocument, plan: PastePlan | null) => {
  if (!plan) throw new Error("no plan");
  return applyOps(doc, plan.ops).doc;
};

/** A document with a $brand color, a component and an instance of it. */
const withComponent: PegoDocument = (() => {
  const doc = applyOps(
    { ...sampleDoc, variables: { brand: { type: "color", value: "#ff0000" } } },
    [
      { op: "update", id: "frame-1", props: { reusable: true } },
      { op: "update", id: "rect-1", props: { fill: "$brand" } },
      {
        op: "insert",
        parentId: page,
        node: { type: "ref", id: "inst", ref: "frame-1", x: 900, y: 0 } as PegoNode,
      },
    ],
  ).doc;
  return doc;
})();

describe("copy", () => {
  test("the payload holds the layers, detached copies and the variables they use", () => {
    const payload = copyPayload(withComponent, ["inst", "frame-1"])!;
    expect(payload.nodes.map((node) => node.id)).toEqual(["inst", "frame-1"]);
    expect(payload.detached[0]?.type).toBe("frame");
    expect(payload.variables).toEqual({ brand: { type: "color", value: "#ff0000" } });
    expect(readPayload(JSON.stringify(payload))).toEqual(payload);
    expect(readPayload("{}")).toBeNull();
    expect(copyPayload(withComponent, [])).toBeNull();
  });
});

describe("paste", () => {
  test("in the same document a copy lands right after its original, shifted", () => {
    const payload = copyPayload(sampleDoc, ["rect-1"])!;
    const plan = pasteNodes(sampleDoc, payload, target)!;
    const doc = apply(sampleDoc, plan);
    const copy = findLocation(doc, plan.select[0]!)!;
    expect(copy.parentId).toBe("frame-1");
    expect(copy.index).toBe(findLocation(doc, "rect-1")!.index + 1);
    expect(copy.node).toMatchObject({ x: 80 + PASTE_OFFSET, y: 120 + PASTE_OFFSET, name: "Card" });
  });

  test("with one frame selected the copies go inside it", () => {
    const payload = copyPayload(sampleDoc, ["text-1"])!;
    const plan = pasteNodes(sampleDoc, payload, { ...target, selection: ["frame-1"] })!;
    expect(findLocation(apply(sampleDoc, plan), plan.select[0]!)?.parentId).toBe("frame-1");
  });

  test("another document gets detached copies in the middle of the view and the missing variables", () => {
    const payload = copyPayload(withComponent, ["inst"])!;
    const other: PegoDocument = { ...sampleDoc, id: "other-doc" };
    const plan = pasteNodes(other, payload, target)!;
    const doc = apply(other, plan);
    const pasted = findNode(doc, plan.select[0]!)!;
    expect(pasted.type).toBe("frame");
    expect(doc.variables.brand).toEqual({ type: "color", value: "#ff0000" });
    // Centered on the view: the frame is 800x600.
    expect(pasted).toMatchObject({ x: 600, y: 200 });
  });

  test("a document's own variable of the same name wins", () => {
    const payload = copyPayload(withComponent, ["rect-1"])!;
    const other: PegoDocument = {
      ...sampleDoc,
      id: "other-doc",
      variables: { brand: { type: "color", value: "#0000ff" } },
    };
    const doc = apply(other, pasteNodes(other, payload, target));
    expect(doc.variables.brand).toEqual({ type: "color", value: "#0000ff" });
  });

  test("SVG markup becomes vector layers; other text becomes a text layer", () => {
    const svg = pasteSvg(
      sampleDoc,
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>',
      target,
    )!;
    const svgNode = findNode(apply(sampleDoc, svg), svg.select[0]!);
    expect(svgNode?.type).toBe("frame");
    expect(pasteSvg(sampleDoc, "hello <svg>", target)).toBeNull();

    const text = pasteText(sampleDoc, "  Hello\r\nworld  ", target)!;
    expect(findNode(apply(sampleDoc, text), text.select[0]!)).toMatchObject({
      type: "text",
      content: "Hello\nworld",
      name: "Hello",
      x: 1000,
      y: 500,
    });
    expect(pasteText(sampleDoc, "   ", target)).toBeNull();
  });
});
