/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { useDocumentStore } from "@/store/use-document-store";
import { requestDecision } from "./decisions";
import { answerDecision, canUndoRunChanges, undoRunChanges } from "./run";
import { insertRect, resetStores, visible } from "./test-utils";
import { createToolHost } from "./tool-host";
import { runScope } from "./use-agent-store";

const docStore = () => useDocumentStore.getState();
const hasRect = (id: string) => JSON.stringify(docStore().doc).includes(id);
const idOf = (op: ReturnType<typeof insertRect>) => (op as { node: { id: string } }).node.id;

beforeEach(resetStores);

describe("undo all", () => {
  // resetStores leaves "run-test" running in the visible session.
  const runTwoSteps = () => {
    runScope("run-test").setPlan([
      { id: "s1", title: "One" },
      { id: "s2", title: "Two" },
    ]);
    const host = createToolHost({ runId: "run-test" });
    const first = insertRect();
    const second = insertRect();
    host.reportStep("s1", "running");
    host.applyOps([first]);
    host.reportStep("s2", "running");
    host.applyOps([second]);
    return { first, second };
  };

  test("reverts exactly the run's transactions as one new undo step", () => {
    docStore().commit([insertRect()], { source: "user" });
    const { first, second } = runTwoSteps();
    expect(visible().transactionCount).toBe(2);
    expect(docStore().history.past.filter((tx) => tx.runId === "run-test")).toHaveLength(2);
    expect(canUndoRunChanges("run-test").ok).toBe(true);

    expect(undoRunChanges("run-test").ok).toBe(true);
    expect([first, second].map(idOf).some(hasRect)).toBe(false);
    // user edit + 2 run steps + the undo itself (redoable with Cmd+Shift+Z)
    expect(docStore().history.past).toHaveLength(4);
    expect(visible().transactionCount).toBe(0);
  });

  test("still allowed when a later edit touched other layers", () => {
    runTwoSteps();
    docStore().commit([insertRect()], { source: "user" });
    expect(canUndoRunChanges("run-test").ok).toBe(true);
  });

  test("refuses with a reason once someone else edited the run's layers", () => {
    const { first } = runTwoSteps();
    docStore().commit([{ op: "update", id: idOf(first), props: { x: 40 } }], { source: "user" });
    const check = canUndoRunChanges("run-test");
    expect(check.ok).toBe(false);
    expect(check.message).toBeTruthy();
    const before = docStore().doc;
    expect(undoRunChanges("run-test").ok).toBe(false);
    expect(docStore().doc).toBe(before);
    expect(visible().transactionCount).toBe(2);
  });

  test("nothing to undo before any run change", () => {
    expect(canUndoRunChanges("run-test").ok).toBe(false);
  });
});

describe("answerDecision", () => {
  test("resolves with the custom text and logs it as a user bubble", async () => {
    const answer = requestDecision(runScope(null), { question: "Which?", options: ["A", "B"] });
    const id = visible().decision?.id ?? "";
    answerDecision(id, "  Tambah section Harga ");
    expect(await answer).toBe("Tambah section Harga");
    const last = visible().log.at(-1);
    expect(last).toMatchObject({ kind: "user", text: "→ Tambah section Harga" });
    expect(visible().decision).toBeNull();
  });

  test("ignores a stale id and empty text", () => {
    const before = visible().log.length;
    answerDecision("decision-missing", "x");
    answerDecision("decision-missing", "   ");
    expect(visible().log).toHaveLength(before);
  });
});
