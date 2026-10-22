import { describe, expect, test } from "bun:test";
import { findNode, findLocation } from "@pego/doc";
import { applyAll, duplicateOps } from "./duplicate";
import { fixtureDoc } from "./test-doc";

describe("duplicateOps", () => {
  test("copy lands right after the original, offset +10", () => {
    const { ops, ids } = duplicateOps(fixtureDoc, ["r1"], 10);
    const next = applyAll(fixtureDoc, ops);
    const [copyId] = ids;
    expect(findLocation(next, copyId!)?.index).toBe(1);
    expect(findNode(next, copyId!)).toMatchObject({ x: 20, y: 20, width: 100 });
    expect(copyId).not.toBe("r1");
  });
  test("flex parent children are not offset", () => {
    const { ops, ids } = duplicateOps(fixtureDoc, ["flexchild"], 10);
    const next = applyAll(fixtureDoc, ops);
    expect(findNode(next, ids[0]!)).toMatchObject({ x: 0, y: 0 });
  });
  test("several siblings keep their own copy right after them", () => {
    const { ops, ids } = duplicateOps(fixtureDoc, ["r2", "r1"], 10);
    const next = applyAll(fixtureDoc, ops);
    const f1 = findNode(next, "f1");
    const order = f1?.type === "frame" ? f1.children.map((c) => c.id) : [];
    expect(order.slice(0, 4)).toEqual(["r1", ids[0]!, "r2", ids[1]!]);
  });
  test("nested selection only duplicates the topmost", () => {
    expect(duplicateOps(fixtureDoc, ["f1", "r1"], 10).ids).toHaveLength(1);
  });
  test("zero offset keeps position (alt-drag)", () => {
    const { ops, ids } = duplicateOps(fixtureDoc, ["r1"], 0);
    expect(findNode(applyAll(fixtureDoc, ops), ids[0]!)).toMatchObject({ x: 10, y: 10 });
  });
});
