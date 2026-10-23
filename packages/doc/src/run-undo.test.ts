import { describe, expect, test } from "bun:test";
import { commit, emptyHistory, undo, type History } from "./history";
import { opTouchedIds, opTouchedVariables, planRunUndo } from "./run-undo";
import { documentSchema, nodeSchema, type PegoDocument } from "./schema";
import { findNode } from "./tree";

const makeDoc = (): PegoDocument =>
  documentSchema.parse({
    version: 7,
    id: "doc",
    name: "Test",
    variables: {},
    children: [
      {
        type: "page",
        id: "page",
        children: [
          { type: "frame", id: "f1", children: [{ type: "rectangle", id: "r1", x: 1 }] },
          { type: "frame", id: "f2", children: [] },
        ],
      },
    ],
  });

const rect = (id: string) => nodeSchema.parse({ type: "rectangle", id });
const agent = (runId: string, label = "step") => ({ source: "agent" as const, runId, label });

type State = { doc: PegoDocument; history: History };
const step = (s: State, ops: Parameters<typeof commit>[2], meta: Parameters<typeof commit>[3]) => {
  const r = commit(s.doc, s.history, ops, meta);
  return { doc: r.doc, history: r.history };
};
const start = (): State => ({ doc: makeDoc(), history: emptyHistory() });

describe("opTouchedIds", () => {
  test("delete includes descendants and insert includes parent", () => {
    const doc = makeDoc();
    expect(opTouchedIds({ op: "delete", id: "f1" }, doc).sort()).toEqual(["f1", "r1"]);
    expect(opTouchedIds({ op: "insert", parentId: "f2", node: rect("n") }, doc).sort()).toEqual([
      "f2",
      "n",
    ]);
    expect(opTouchedIds({ op: "move", id: "r1", parentId: "f2" }, doc).sort()).toEqual([
      "f1",
      "f2",
      "r1",
    ]);
    expect(opTouchedIds({ op: "setVariables", variables: { a: null } }, doc)).toEqual([]);
    expect(opTouchedVariables({ op: "setVariables", variables: { a: null } })).toEqual(["a"]);
  });
});

describe("planRunUndo", () => {
  test("nothing when run has no transactions", () => {
    const s = start();
    const plan = planRunUndo(s.doc, s.history, "x");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("nothing");
  });

  test("reverts only the run, interleaved with another run on other nodes", () => {
    let s = start();
    s = step(s, [{ op: "insert", parentId: "f1", node: rect("a1") }], agent("A"));
    s = step(s, [{ op: "insert", parentId: "f2", node: rect("b1") }], agent("B"));
    s = step(s, [{ op: "update", id: "a1", props: { x: 5 } }], agent("A"));
    const plan = planRunUndo(s.doc, s.history, "A");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.count).toBe(2);
    const undone = step(s, plan.ops, { source: "user", label: plan.label });
    expect(findNode(undone.doc, "a1")).toBeNull();
    expect(findNode(undone.doc, "b1")).not.toBeNull();
    // Cmd+Z restores the run's changes
    const back = undo(undone.doc, undone.history)!;
    expect(back.doc).toEqual(s.doc);
  });

  test("conflict when the user later moved a node the run created", () => {
    let s = start();
    s = step(s, [{ op: "insert", parentId: "f1", node: rect("a1") }], agent("A"));
    s = step(s, [{ op: "move", id: "a1", parentId: "f2" }], { source: "user", label: "Move" });
    const plan = planRunUndo(s.doc, s.history, "A");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toBe("conflict");
      expect(plan.message).toContain('"Move"');
    }
  });

  test("conflict when a later edit deletes the run's parent subtree", () => {
    let s = start();
    s = step(s, [{ op: "insert", parentId: "f2", node: rect("a1") }], agent("A"));
    s = step(s, [{ op: "delete", id: "f2" }], { source: "user", label: "Delete" });
    const plan = planRunUndo(s.doc, s.history, "A");
    expect(plan.ok).toBe(false);
  });

  test("variables conflict", () => {
    const v = { type: "color" as const, value: "#ffffff" };
    let s = start();
    s = step(s, [{ op: "setVariables", variables: { brand: v } }], agent("A"));
    s = step(s, [{ op: "setVariables", variables: { brand: null } }], {
      source: "user",
      label: "Vars",
    });
    const plan = planRunUndo(s.doc, s.history, "A");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("variables");
  });
});
