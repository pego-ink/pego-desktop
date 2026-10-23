/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  computeLayout,
  findLocation,
  findNode,
  sampleDoc,
  type PegoDocument,
  type PegoNode,
  type TextMeasurer,
} from "@pego/doc";
import {
  allComponents,
  componentOf,
  detachInstances,
  restack,
  toggleComponent,
  ungroupSelection,
  wrapSelection,
  type StructureResult,
} from "./structure";

const measure: TextMeasurer = () => ({ width: 100, height: 20 });
const layoutOf = (doc: PegoDocument) => computeLayout(doc, measure);

/** Apply a plan; fails the test when it was refused. */
const run = (doc: PegoDocument, result: StructureResult) => {
  if ("error" in result) throw new Error(result.error);
  return { doc: applyOps(doc, result.ops).doc, select: result.select };
};

/** Absolute box of a node (to check that it did not move on the canvas). */
const boxOf = (doc: PegoDocument, id: string) => layoutOf(doc).get(id);

const childIds = (doc: PegoDocument, id: string) =>
  ((findNode(doc, id) as { children?: PegoNode[] }).children ?? []).map((node) => node.id);

describe("group and frame", () => {
  test("wrapping keeps every layer where it was on the canvas", () => {
    for (const kind of ["group", "frame"] as const) {
      const before = layoutOf(sampleDoc);
      const after = run(sampleDoc, wrapSelection(sampleDoc, before, ["rect-1", "text-1"], kind));
      const id = after.select[0]!;
      expect(findNode(after.doc, id)?.type).toBe(kind);
      expect(childIds(after.doc, "frame-1")).toEqual([id]);
      expect(childIds(after.doc, id)).toEqual(["rect-1", "text-1"]);
      expect(boxOf(after.doc, "rect-1")).toEqual(before.get("rect-1"));
      expect(boxOf(after.doc, "text-1")).toEqual(before.get("text-1"));
    }
  });

  test("a frame gets the selection's size and the next free name", () => {
    const after = run(
      sampleDoc,
      wrapSelection(sampleDoc, layoutOf(sampleDoc), ["rect-1", "text-1"], "frame"),
    );
    expect(findNode(after.doc, after.select[0]!)).toMatchObject({
      name: "Frame 1",
      layout: "none",
      x: 80,
      y: 56,
      width: 640,
      height: 264,
    });
  });

  test("layers in different parents are refused", () => {
    const result = wrapSelection(sampleDoc, layoutOf(sampleDoc), ["frame-1", "rect-1"], "group");
    // frame-1 contains rect-1: only the topmost is wrapped, so this one works...
    expect("error" in result).toBe(false);
    const nested = run(
      sampleDoc,
      wrapSelection(sampleDoc, layoutOf(sampleDoc), ["rect-1"], "group"),
    );
    const mixed = wrapSelection(nested.doc, layoutOf(nested.doc), ["rect-1", "text-1"], "group");
    expect(mixed).toEqual({ error: "Select layers that sit in the same frame or group." });
  });

  test("ungroup puts the children back in place, at the container's spot", () => {
    const before = layoutOf(sampleDoc);
    const grouped = run(sampleDoc, wrapSelection(sampleDoc, before, ["rect-1", "text-1"], "group"));
    const back = run(
      grouped.doc,
      ungroupSelection(grouped.doc, layoutOf(grouped.doc), grouped.select),
    );
    expect(childIds(back.doc, "frame-1")).toEqual(["rect-1", "text-1"]);
    expect(back.select).toEqual(["rect-1", "text-1"]);
    expect(boxOf(back.doc, "rect-1")).toEqual(before.get("rect-1"));
    expect(ungroupSelection(sampleDoc, before, ["rect-1"])).toEqual({
      error: "Select a group or frame to ungroup.",
    });
  });
});

describe("components", () => {
  test("a frame becomes a component; other layers are wrapped in one first", () => {
    const frame = run(sampleDoc, toggleComponent(sampleDoc, layoutOf(sampleDoc), ["frame-1"]));
    expect(findNode(frame.doc, "frame-1")?.reusable).toBe(true);
    expect(allComponents(frame.doc, ["frame-1"])).toBe(true);

    const card = run(sampleDoc, toggleComponent(sampleDoc, layoutOf(sampleDoc), ["rect-1"]));
    const wrapper = findNode(card.doc, card.select[0]!);
    expect(wrapper).toMatchObject({ type: "frame", reusable: true, name: "Component" });
    expect(childIds(card.doc, wrapper!.id)).toEqual(["rect-1"]);
  });

  test("detaching a component turns its instances into plain copies first", () => {
    const made = run(sampleDoc, toggleComponent(sampleDoc, layoutOf(sampleDoc), ["frame-1"]));
    const page = findLocation(made.doc, "frame-1")!.parentId;
    const withInstance = applyOps(made.doc, [
      {
        op: "insert",
        parentId: page,
        node: { type: "ref", id: "inst", ref: "frame-1", x: 900, y: 0 },
      },
    ]).doc;
    expect(componentOf(withInstance, "inst")).toBe("frame-1");

    const detached = run(
      withInstance,
      toggleComponent(withInstance, layoutOf(withInstance), ["frame-1"]),
    );
    expect(findNode(detached.doc, "frame-1")?.reusable).toBeUndefined();
    expect(findNode(detached.doc, "inst")).toBeNull();
    const pageChildren = childIds(detached.doc, page!);
    expect(pageChildren).toHaveLength(2);
    expect(findNode(detached.doc, pageChildren[1]!)?.type).toBe("frame");
  });

  test("detach instance replaces the ref with what it shows", () => {
    const made = run(sampleDoc, toggleComponent(sampleDoc, layoutOf(sampleDoc), ["frame-1"]));
    const page = findLocation(made.doc, "frame-1")!.parentId;
    const doc = applyOps(made.doc, [
      {
        op: "insert",
        parentId: page,
        node: { type: "ref", id: "inst", ref: "frame-1", x: 900, y: 0 },
      },
    ]).doc;
    const detached = run(doc, detachInstances(doc, ["inst"]));
    const copy = findNode(detached.doc, detached.select[0]!);
    expect(copy).toMatchObject({ type: "frame", x: 900 });
    expect(copy?.reusable).toBeFalsy();
    expect(detachInstances(sampleDoc, ["rect-1"])).toEqual({
      error: "Select a component instance to detach.",
    });
  });
});

describe("stacking", () => {
  test("bring to front and send to back keep the selection's own order", () => {
    const front = run(sampleDoc, restack(sampleDoc, ["rect-1"], "front"));
    expect(childIds(front.doc, "frame-1")).toEqual(["text-1", "rect-1"]);
    const back = run(front.doc, restack(front.doc, ["rect-1"], "back"));
    expect(childIds(back.doc, "frame-1")).toEqual(["rect-1", "text-1"]);
  });
});

describe("hidden layers", () => {
  const hidden = (doc: PegoDocument, id: string) =>
    applyOps(doc, [{ op: "update", id, props: { visible: false } }]).doc;

  test("ungroup keeps a hidden child at container offset + its own x/y", () => {
    let doc = applyOps(sampleDoc, [
      {
        op: "insert",
        parentId: "page-1",
        node: {
          type: "group",
          id: "grp",
          x: 500,
          y: 300,
          children: [
            { type: "rectangle", id: "hid", x: 10, y: 20, width: 30, height: 40, visible: false },
          ],
        } as PegoNode,
      },
    ]).doc;
    doc = hidden(doc, "grp");
    const { doc: after } = run(doc, ungroupSelection(doc, layoutOf(doc), ["grp"]));
    const node = findNode(after, "hid") as { x: number; y: number };
    expect([node.x, node.y]).toEqual([510, 320]);
  });

  test("wrapping a hidden layer works", () => {
    const doc = hidden(sampleDoc, "rect-1");
    const result = wrapSelection(doc, layoutOf(doc), ["rect-1"], "group");
    expect("error" in result).toBe(false);
  });
});
