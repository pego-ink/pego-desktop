import { describe, expect, test } from "bun:test";
import { applyOp, findNode } from "@pego/doc";
import {
  clickBox,
  createNodeOp,
  deepestFrameId,
  drawBox,
  drawUpdateOps,
  resolvePlacement,
  uniqueName,
} from "./create-node";
import { fixtureDoc, fixtureLayout } from "./test-doc";

describe("drawBox", () => {
  test("normalizes a drag in any direction", () => {
    expect(drawBox({ x: 100, y: 100 }, { x: 40, y: 60 })).toEqual({
      x: 40,
      y: 60,
      width: 60,
      height: 40,
    });
  });
  test("shift makes a square in the drag direction", () => {
    expect(drawBox({ x: 0, y: 0 }, { x: -50, y: 20 }, { shift: true })).toEqual({
      x: -50,
      y: 0,
      width: 50,
      height: 50,
    });
  });
  test("alt draws from the center", () => {
    expect(drawBox({ x: 100, y: 100 }, { x: 120, y: 130 }, { alt: true })).toEqual({
      x: 80,
      y: 70,
      width: 40,
      height: 60,
    });
  });
  test("never smaller than 1", () => {
    expect(drawBox({ x: 5, y: 5 }, { x: 5, y: 5 }).width).toBe(1);
  });
});

describe("clickBox", () => {
  test("uses default sizes", () => {
    expect(clickBox("frame", { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 400, height: 300 });
    expect(clickBox("ellipse", { x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 100, height: 100 });
  });
});

describe("placement", () => {
  test("deepest frame wins, groups and leaves are skipped", () => {
    expect(deepestFrameId(fixtureDoc, ["f1", "g1", "gr"])).toBe("f1");
    expect(deepestFrameId(fixtureDoc, null)).toBeNull();
  });
  test("top level when nothing is hit", () => {
    expect(resolvePlacement(fixtureDoc, fixtureLayout, null)).toEqual({
      parentId: "page-1",
      originX: 0,
      originY: 0,
      flex: false,
    });
  });
  test("flex parent is flagged", () => {
    expect(resolvePlacement(fixtureDoc, fixtureLayout, ["f2"]).flex).toBe(true);
  });
});

describe("uniqueName", () => {
  const sibling = (name: string) => ({ ...fixtureDoc.children[0]!, name });
  test("keeps a free name", () => {
    expect(uniqueName("Rectangle", [sibling("Frame")])).toBe("Rectangle");
  });
  test("appends the next free number", () => {
    expect(uniqueName("Rectangle", [sibling("Rectangle")])).toBe("Rectangle 2");
    expect(uniqueName("Rectangle", [sibling("Rectangle"), sibling("Rectangle 2")])).toBe(
      "Rectangle 3",
    );
  });
});

describe("createNodeOp", () => {
  test("inside a free frame uses parent-relative coordinates", () => {
    const placement = { parentId: "f1", originX: 0, originY: 0, flex: false };
    const op = createNodeOp(fixtureDoc, "rectangle", "new", placement, {
      x: 20,
      y: 30,
      width: 50,
      height: 60,
    });
    const next = applyOp(fixtureDoc, op);
    expect(findNode(next, "new")).toMatchObject({
      type: "rectangle",
      x: 20,
      y: 30,
      width: 50,
      height: 60,
      fill: "#D9D9D9",
      name: "Rectangle",
    });
  });
  test("origin offset is subtracted", () => {
    const placement = { parentId: "f1", originX: 100, originY: 100, flex: false };
    const op = createNodeOp(fixtureDoc, "ellipse", "e", placement, {
      x: 150,
      y: 170,
      width: 10,
      height: 10,
    });
    expect(findNode(applyOp(fixtureDoc, op), "e")).toMatchObject({ x: 50, y: 70 });
  });
  test("flex parent: appended last, size only", () => {
    const placement = resolvePlacement(fixtureDoc, fixtureLayout, ["f2"]);
    const op = createNodeOp(
      fixtureDoc,
      "rectangle",
      "n",
      placement,
      clickBox("rectangle", { x: 700, y: 50 }),
    );
    const next = applyOp(fixtureDoc, op);
    const f2 = findNode(next, "f2");
    expect(f2?.type === "frame" && f2.children.at(-1)?.id).toBe("n");
    expect(findNode(next, "n")).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(drawUpdateOps("n", placement, { x: 1, y: 2, width: 3, height: 4 })).toEqual([
      { op: "update", id: "n", props: { width: 3, height: 4 } },
    ]);
  });
  test("new frame has white fill and an empty children list", () => {
    const placement = { parentId: "page-1", originX: 0, originY: 0, flex: false };
    const next = applyOp(
      fixtureDoc,
      createNodeOp(fixtureDoc, "frame", "fr", placement, clickBox("frame", { x: 900, y: 0 })),
    );
    expect(findNode(next, "fr")).toMatchObject({ fill: "#FFFFFF", children: [], layout: "none" });
  });
});
