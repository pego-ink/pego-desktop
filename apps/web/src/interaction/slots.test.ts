/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  applyOps,
  computeLayout,
  findNode,
  resolveInstance,
  sampleDoc,
  type FrameNode,
  type PegoDocument,
  type PegoNode,
  type RefNode,
} from "@pego/doc";
import {
  clearSlotOp,
  componentAround,
  componentChoices,
  fillSlotOp,
  recommendOp,
  slotFill,
  slotsOf,
  toggleSlotOp,
} from "./slots";

const page = sampleDoc.children[0]!.id;

/**
 * A "Card" component (frame-1) whose "Body" frame is a slot recommending "Badge", a "Badge"
 * component, and an instance of the card.
 */
const doc: PegoDocument = applyOps(sampleDoc, [
  { op: "update", id: "frame-1", props: { reusable: true, name: "Card" } },
  {
    op: "insert",
    parentId: "frame-1",
    node: {
      type: "frame",
      id: "body",
      name: "Body",
      x: 40,
      y: 400,
      width: 200,
      height: 80,
      layout: "none",
      slot: ["badge"],
      children: [{ type: "rectangle", id: "placeholder", x: 0, y: 0, width: 10, height: 10 }],
    } as PegoNode,
  },
  {
    op: "insert",
    parentId: page,
    node: {
      type: "frame",
      id: "badge",
      name: "Badge",
      reusable: true,
      x: 2000,
      y: 0,
      width: 60,
      height: 24,
      layout: "none",
      children: [],
    } as PegoNode,
  },
  {
    op: "insert",
    parentId: page,
    node: { type: "ref", id: "inst", ref: "frame-1", x: 1000, y: 0 },
  },
]).doc;

const instance = () => findNode(doc, "inst") as RefNode;

describe("component side", () => {
  test("slots and the component around a layer", () => {
    expect(componentAround(doc, "placeholder")?.id).toBe("frame-1");
    expect(componentAround(doc, "badge")?.id).toBe("badge");
    expect(componentAround(sampleDoc, "rect-1")).toBeNull();
    expect(slotsOf(findNode(doc, "frame-1")!).map((frame) => frame.id)).toEqual(["body"]);
    expect(componentChoices(doc, "frame-1").map((node) => node.id)).toEqual(["badge"]);
  });

  test("make, recommend and remove", () => {
    const body = findNode(doc, "body") as FrameNode;
    const removed = applyOps(doc, [toggleSlotOp(body)]).doc;
    expect((findNode(removed, "body") as FrameNode).slot).toBeUndefined();
    const plain = findNode(removed, "body") as FrameNode;
    expect(
      (findNode(applyOps(removed, [toggleSlotOp(plain)]).doc, "body") as FrameNode).slot,
    ).toEqual([]);
    const more = applyOps(doc, [recommendOp(body, "frame-1", true)]).doc;
    expect((findNode(more, "body") as FrameNode).slot).toEqual(["badge", "frame-1"]);
    const fewer = applyOps(doc, [recommendOp(body, "badge", false)]).doc;
    expect((findNode(fewer, "body") as FrameNode).slot).toEqual([]);
  });
});

describe("instance side", () => {
  test("filling a slot replaces its content in that instance only; reset brings it back", () => {
    const filled = applyOps(doc, [fillSlotOp(instance(), "body", "badge")]).doc;
    const inst = findNode(filled, "inst") as RefNode;
    expect(slotFill(inst, "body")?.[0]).toMatchObject({ type: "ref", ref: "badge" });

    const expanded = resolveInstance(filled, inst) as FrameNode;
    const body = expanded.children.find((child) => child.id === "inst/body") as FrameNode;
    expect(body.children).toHaveLength(1);
    expect(body.children[0]).toMatchObject({ type: "ref", ref: "badge" });
    expect(body.children[0]!.id.startsWith("inst/")).toBe(true);
    // The component and its layout are unchanged; the slot content gets a box.
    expect(findNode(filled, "placeholder")).not.toBeNull();
    const layout = computeLayout(filled, () => ({ width: 10, height: 10 }));
    expect(layout.get(body.children[0]!.id)).toMatchObject({ width: 60, height: 24 });

    const reset = applyOps(filled, [clearSlotOp(inst, "body")]).doc;
    const back = findNode(reset, "inst") as RefNode;
    expect(back.descendants).toBeUndefined();
    const restored = resolveInstance(reset, back) as FrameNode;
    const restoredBody = restored.children.find((child) => child.id === "inst/body") as FrameNode;
    expect(restoredBody.children.map((child) => child.id)).toEqual(["inst/placeholder"]);
  });

  test("children overrides on frames that are not slots are ignored", () => {
    const sneaky = applyOps(doc, [
      {
        op: "update",
        id: "inst",
        props: {
          descendants: { "rect-1": { children: [{ type: "text", id: "t", content: "x" }] } },
        },
      },
    ]).doc;
    const expanded = resolveInstance(sneaky, findNode(sneaky, "inst") as RefNode) as FrameNode;
    expect(expanded.children.find((child) => child.id === "inst/rect-1")?.type).toBe("rectangle");
  });
});
