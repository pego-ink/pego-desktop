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
  MAX_PAYLOAD_CHARS,
  MAX_PAYLOAD_NODES,
  PASTE_OFFSET,
  pasteNodes,
  pasteNodesAt,
  payloadFromText,
  replaceWithNodes,
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
    expect(payload.detached?.[0]?.type).toBe("frame");
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
    expect(svgNode?.type).toBe("group");
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

describe("untrusted clipboard data", () => {
  const good = () => copyPayload(sampleDoc, ["rect-1"])!;
  const read = (patch: Record<string, unknown>) =>
    readPayload(JSON.stringify({ ...good(), ...patch }));

  test("rejects nodes that fail the schema", () => {
    const bad = { type: "text", id: "t", content: 5 };
    expect(read({ nodes: [bad] })).toBeNull();
    expect(read({ nodes: [{ type: "page", id: "p", children: [] }] })).toBeNull();
    expect(read({ nodes: "x" })).toBeNull();
    expect(read({ detached: [bad] })).toBeNull();
  });

  test("rejects bad variables and oversized payloads", () => {
    expect(read({ variables: { a: { type: "color", value: 3 } } })).toBeNull();
    expect(readPayload("x".repeat(MAX_PAYLOAD_CHARS + 1))).toBeNull();
    const many = Array.from({ length: MAX_PAYLOAD_NODES + 1 }, (_, i) => ({
      type: "group",
      id: `g${i}`,
      children: [],
    }));
    expect(read({ nodes: many })).toBeNull();
  });

  test("a valid payload round-trips", () => {
    expect(read({})).toEqual(good());
  });

  test("detached is only copied when a layer holds an instance", () => {
    expect(good().detached).toBeUndefined();
    expect(copyPayload(withComponent, ["inst"])!.detached).toBeDefined();
  });
});

describe("several originals", () => {
  test("copies sharing a parent each land after their own original", () => {
    const payload = copyPayload(sampleDoc, ["rect-1", "text-1"])!;
    const doc = apply(sampleDoc, pasteNodes(sampleDoc, payload, target));
    const ids = (findNode(doc, "frame-1") as { children: PegoNode[] }).children.map((n) => n.id);
    const rect = ids.indexOf("rect-1");
    const text = ids.indexOf("text-1");
    expect(findNode(doc, ids[rect + 1]!)?.type).toBe("rectangle");
    expect(findNode(doc, ids[text + 1]!)?.type).toBe("text");
  });
});

describe("paste here and paste to replace", () => {
  const rect = (id: string, x: number, y: number): PegoNode => ({
    type: "rectangle",
    id,
    x,
    y,
    width: 40,
    height: 30,
  });
  const base = (): PegoDocument => ({
    ...sampleDoc,
    children: [
      {
        type: "page",
        id: "pg",
        name: "Page 1",
        x: 0,
        y: 0,
        children: [rect("a", 100, 100), rect("b", 300, 50)],
      } as PegoNode,
    ] as PegoDocument["children"],
  });
  const payload = (doc: PegoDocument, ids: string[]) => copyPayload(doc, ids)!;

  test("paste here puts the bounds' top-left at the point", () => {
    const doc = base();
    const plan = pasteNodesAt(
      doc,
      new Map(),
      payload(doc, ["a", "b"]),
      { x: 10, y: 20 },
      {
        pageId: "pg",
        selection: [],
      },
    )!;
    const next = applyOps(doc, plan.ops).doc;
    const [a, b] = plan.select.map((id) => findNode(next, id)!);
    expect([a!.x, a!.y]).toEqual([10, 70]);
    expect([b!.x, b!.y]).toEqual([210, 20]);
  });

  test("paste here inside a selected frame uses its origin", () => {
    const doc = applyOps(base(), [
      {
        op: "insert",
        parentId: "pg",
        node: {
          type: "frame",
          id: "fr",
          x: 500,
          y: 500,
          width: 200,
          height: 200,
          layout: "none",
          children: [],
        } as PegoNode,
      },
    ]).doc;
    const layout = new Map([["fr", { x: 500, y: 500, width: 200, height: 200 }]]);
    const plan = pasteNodesAt(
      doc,
      layout,
      payload(doc, ["a"]),
      { x: 520, y: 540 },
      {
        pageId: "pg",
        selection: ["fr"],
      },
    )!;
    const next = applyOps(doc, plan.ops).doc;
    expect(findLocation(next, plan.select[0]!)?.parentId).toBe("fr");
    expect(findNode(next, plan.select[0]!)).toMatchObject({ x: 20, y: 40 });
  });

  test("paste to replace swaps each selected layer in place, in one op list", () => {
    const doc = base();
    const plan = replaceWithNodes(doc, payload(doc, ["a"]), ["b"]);
    if ("error" in plan) throw new Error(plan.error);
    const next = applyOps(doc, plan.ops).doc;
    expect(findNode(next, "b")).toBeNull();
    const copy = findNode(next, plan.select[0]!)!;
    expect(findLocation(next, copy.id)?.index).toBe(1);
    expect([copy.x, copy.y]).toEqual([300, 50]);
  });

  test("paste to replace needs a selection", () => {
    const doc = base();
    expect(replaceWithNodes(doc, payload(doc, ["a"]), [])).toHaveProperty("error");
  });

  test("text on the clipboard becomes a one-layer payload", () => {
    const doc = base();
    const result = payloadFromText(doc, "Hello");
    expect(result?.nodes[0]).toMatchObject({ type: "text", content: "Hello" });
    expect(payloadFromText(doc, "  ")).toBeNull();
  });
});
