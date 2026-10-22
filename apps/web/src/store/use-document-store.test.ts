import { beforeEach, describe, expect, test } from "bun:test";
import { nodeSchema } from "@pego/doc";
import { useDocumentStore } from "./use-document-store";

const rect = (id: string) => nodeSchema.parse({ type: "rectangle", id });
const frame = nodeSchema.parse({ type: "frame", id: "root", children: [] });

beforeEach(() => {
  const s = useDocumentStore.getState();
  s.load({
    ...s.doc,
    children: [{ type: "page", id: "page", name: "Page 1", x: 0, y: 0, children: [frame] }],
  });
});

describe("undoRun", () => {
  test("reverts one run as a single undoable step", () => {
    const s = useDocumentStore.getState();
    s.commit([{ op: "insert", parentId: "root", node: rect("a") }], {
      source: "agent",
      runId: "A",
    });
    s.commit([{ op: "insert", parentId: "root", node: rect("b") }], {
      source: "agent",
      runId: "B",
    });
    expect(useDocumentStore.getState().canUndoRun("A").ok).toBe(true);
    expect(useDocumentStore.getState().undoRun("A").ok).toBe(true);
    const ids = () => JSON.stringify(useDocumentStore.getState().doc.children);
    expect(ids()).not.toContain('"a"');
    expect(ids()).toContain('"b"');
    useDocumentStore.getState().undo();
    expect(ids()).toContain('"a"');
  });

  test("blocked after a conflicting later edit", () => {
    const s = useDocumentStore.getState();
    s.commit([{ op: "insert", parentId: "root", node: rect("a") }], {
      source: "agent",
      runId: "A",
    });
    s.commit([{ op: "update", id: "a", props: { x: 3 } }], { label: "Nudge" });
    const res = useDocumentStore.getState().undoRun("A");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Nudge");
    expect(useDocumentStore.getState().canUndoRun("A").ok).toBe(false);
  });
});
