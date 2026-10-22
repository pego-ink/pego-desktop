import { describe, expect, test } from "bun:test";
import { cloneWithFreshIds, createId } from "./id";
import type { PegoNode } from "./schema";
import { collectIds } from "./tree";

describe("createId", () => {
  test("is 8 chars of [0-9a-z]", () => {
    for (let i = 0; i < 200; i++) expect(createId()).toMatch(/^[0-9a-z]{8}$/);
  });
  test("10k ids have no duplicates", () => {
    const ids = new Set(Array.from({ length: 10_000 }, createId));
    expect(ids.size).toBe(10_000);
  });
});

const tree: PegoNode = {
  type: "frame",
  id: "root",
  name: "Root",
  x: 1,
  y: 2,
  width: 300,
  height: 200,
  layout: "none",
  clip: true,
  children: [
    { type: "rectangle", id: "a", x: 5, y: 6, width: 10, height: 10, rotation: 30 },
    {
      type: "group",
      id: "g",
      x: 0,
      y: 0,
      children: [{ type: "rectangle", id: "b", x: 7, y: 8, width: 20, height: 20 }],
    },
  ],
};

const stripIds = (node: PegoNode): unknown => {
  const rest: Record<string, unknown> = { ...node, id: "-" };
  return "children" in node ? { ...rest, children: node.children.map(stripIds) } : rest;
};

describe("cloneWithFreshIds", () => {
  test("gives every node a new unique id", () => {
    const copy = cloneWithFreshIds(tree);
    const oldIds = collectIds(tree);
    const newIds = collectIds(copy);
    expect(newIds.size).toBe(oldIds.size);
    for (const id of newIds) expect(oldIds.has(id)).toBe(false);
  });
  test("keeps all other props and structure", () => {
    expect(stripIds(cloneWithFreshIds(tree))).toEqual(stripIds(tree));
  });
  test("does not mutate the input", () => {
    const snapshot = structuredClone(tree);
    cloneWithFreshIds(tree);
    expect(tree).toEqual(snapshot);
  });
});
