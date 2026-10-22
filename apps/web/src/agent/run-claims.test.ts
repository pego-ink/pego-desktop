/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { sampleDoc, type Op } from "@pego/doc";
import { claimTargets, createClaims, parentMap } from "./run-claims";

const rect = (id: string, parentId: string | null = "frame-1"): Op =>
  ({
    op: "insert",
    parentId,
    node: { type: "rectangle", id, x: 0, y: 0, width: 10, height: 10 },
  }) as Op;
const update = (id: string): Op => ({ op: "update", id, props: { x: 1 } });

const always = () => true;

describe("parentMap / claimTargets", () => {
  test("maps every node to its parent", () => {
    const parents = parentMap(sampleDoc);
    expect(parents.get("page-1")).toBeNull();
    expect(parents.get("frame-1")).toBe("page-1");
    expect(parents.get("rect-1")).toBe("frame-1");
  });

  test("an insert claims the new node, not the frame it was added to", () => {
    expect(claimTargets(rect("new"), sampleDoc)).toEqual(["new"]);
  });

  test("a move claims the node, not its old or new parent", () => {
    const move: Op = { op: "move", id: "rect-1", parentId: null, index: 0 };
    expect(claimTargets(move, sampleDoc)).toEqual(["rect-1"]);
  });

  test("pages are never claimed", () => {
    const rename: Op = { op: "update", id: "page-1", props: { name: "Home" } } as Op;
    expect(claimTargets(rename, sampleDoc)).toEqual([]);
    expect(claimTargets(rect("top", "page-1"), sampleDoc)).toEqual(["top"]);
  });

  test("a delete claims the whole subtree", () => {
    expect(claimTargets({ op: "delete", id: "frame-1" }, sampleDoc).sort()).toEqual(
      ["frame-1", "rect-1", "text-1"].sort(),
    );
  });
});

describe("claims", () => {
  let claims = createClaims();
  beforeEach(() => {
    claims = createClaims();
  });

  test("nothing claimed: no conflict", () => {
    expect(claims.conflict(sampleDoc, [update("rect-1")], "b", always)).toBeNull();
  });

  test("another run's node is refused; the owner itself is not", () => {
    claims.claim(sampleDoc, [update("rect-1")], "a");
    expect(claims.conflict(sampleDoc, [update("rect-1")], "b", always)).toEqual({
      nodeId: "rect-1",
      runId: "a",
    });
    expect(claims.conflict(sampleDoc, [update("rect-1")], "a", always)).toBeNull();
  });

  test("a descendant of a claimed node counts, so does adding into it", () => {
    claims.claim(sampleDoc, [update("frame-1")], "a");
    expect(claims.conflict(sampleDoc, [update("text-1")], "b", always)?.nodeId).toBe("frame-1");
    expect(claims.conflict(sampleDoc, [rect("x")], "b", always)?.runId).toBe("a");
  });

  test("adding next to another run's new node in the same frame is fine", () => {
    claims.claim(sampleDoc, [rect("a-card")], "a");
    expect(claims.conflict(sampleDoc, [rect("b-card")], "b", always)).toBeNull();
    expect(claims.conflict(sampleDoc, [update("rect-1")], "b", always)).toBeNull();
  });

  test("claims of runs that are no longer active, or released, do not block", () => {
    claims.claim(sampleDoc, [update("rect-1")], "a");
    expect(claims.conflict(sampleDoc, [update("rect-1")], "b", () => false)).toBeNull();
    claims.release("a");
    expect(claims.ownerOf("rect-1")).toBeUndefined();
    expect(claims.conflict(sampleDoc, [update("rect-1")], "b", always)).toBeNull();
  });
});
