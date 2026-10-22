/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { applyOp, type PegoDocument } from "@pego/doc";
import { buildMoveOp, dropZoneAt } from "./drop-position";

const rect = (id: string) => ({ type: "rectangle" as const, id, x: 0, y: 0 });
const doc: PegoDocument = {
  version: 0,
  id: "d",
  name: "d",
  variables: {},
  children: [
    {
      type: "frame",
      id: "f1",
      x: 0,
      y: 0,
      layout: "none",
      children: [rect("a"), rect("b"), rect("c")],
    },
    { type: "frame", id: "f2", x: 0, y: 0, layout: "none", children: [] },
    rect("r"),
  ],
};

const ids = (d: PegoDocument, parent: string | null) =>
  (parent === null
    ? d.children
    : (d.children.find((n) => n.id === parent) as never as { children: { id: string }[] }).children
  ).map((n: { id: string }) => n.id);

describe("dropZoneAt", () => {
  test("non-containers split in halves", () => {
    expect(dropZoneAt(0.2, false)).toBe("before");
    expect(dropZoneAt(0.8, false)).toBe("after");
  });
  test("containers have an inside band", () => {
    expect(dropZoneAt(0.1, true)).toBe("before");
    expect(dropZoneAt(0.5, true)).toBe("inside");
    expect(dropZoneAt(0.9, true)).toBe("after");
  });
});

describe("buildMoveOp", () => {
  test("after a later sibling uses the final index", () => {
    const op = buildMoveOp(doc, "a", "c", "after");
    expect(op).toEqual({ op: "move", id: "a", parentId: "f1", index: 2 });
    expect(ids(applyOp(doc, op!), "f1")).toEqual(["b", "c", "a"]);
  });
  test("before an earlier sibling", () => {
    const op = buildMoveOp(doc, "c", "a", "before");
    expect(op).toEqual({ op: "move", id: "c", parentId: "f1", index: 0 });
    expect(ids(applyOp(doc, op!), "f1")).toEqual(["c", "a", "b"]);
  });
  test("no-op drops return null", () => {
    expect(buildMoveOp(doc, "b", "a", "after")).toBeNull();
    expect(buildMoveOp(doc, "b", "c", "before")).toBeNull();
    expect(buildMoveOp(doc, "a", "a", "before")).toBeNull();
  });
  test("inside a container appends as last child", () => {
    expect(buildMoveOp(doc, "r", "f2", "inside")).toEqual({
      op: "move",
      id: "r",
      parentId: "f2",
      index: 0,
    });
    expect(buildMoveOp(doc, "a", "f1", "inside")).toEqual({
      op: "move",
      id: "a",
      parentId: "f1",
      index: 2,
    });
  });
  test("drop next to a nested row targets its parent, to root for top-level", () => {
    expect(buildMoveOp(doc, "r", "b", "before")).toEqual({
      op: "move",
      id: "r",
      parentId: "f1",
      index: 1,
    });
    expect(buildMoveOp(doc, "a", "r", "after")).toEqual({
      op: "move",
      id: "a",
      parentId: null,
      index: 3,
    });
  });
  test("never into non-containers, itself or descendants", () => {
    expect(buildMoveOp(doc, "a", "b", "inside")).toBeNull();
    expect(buildMoveOp(doc, "f1", "f1", "inside")).toBeNull();
    expect(buildMoveOp(doc, "f1", "a", "before")).toBeNull();
    expect(buildMoveOp(doc, "f1", "a", "after")).toBeNull();
  });
});
