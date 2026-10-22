/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { useDocumentStore } from "@/store/use-document-store";
import { setRunTail } from "./active-run";
import { canUndoRunChanges, undoRunChanges } from "./run";
import { insertRect, resetStores } from "./test-utils";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

const docStore = () => useDocumentStore.getState();
const hasRect = (id: string) => JSON.stringify(docStore().doc).includes(id);

beforeEach(resetStores);

describe("undo all", () => {
  const runTwoSteps = () => {
    useAgentStore.getState().setPlan([
      { id: "s1", title: "One" },
      { id: "s2", title: "Two" },
    ]);
    const host = createToolHost({ onTransaction: setRunTail });
    const first = insertRect();
    const second = insertRect();
    host.reportStep("s1", "running");
    host.applyOps([first]);
    host.reportStep("s2", "running");
    host.applyOps([second]);
    return { first, second };
  };

  test("undoes exactly the run's transactions when they are newest", () => {
    docStore().commit([insertRect()], { source: "user" });
    const { first, second } = runTwoSteps();
    const rectIds = [first, second].map((op) => (op as { node: { id: string } }).node.id);
    expect(useAgentStore.getState().transactionCount).toBe(2);
    expect(canUndoRunChanges()).toBe(true);

    undoRunChanges();
    expect(rectIds.some(hasRect)).toBe(false);
    expect(docStore().history.past).toHaveLength(1); // the earlier user edit survives
    expect(useAgentStore.getState().transactionCount).toBe(0);
    expect(canUndoRunChanges()).toBe(false);
  });

  test("refuses once the user edited after the run", () => {
    runTwoSteps();
    docStore().commit([insertRect()], { source: "user" });
    expect(canUndoRunChanges()).toBe(false);
    const before = docStore().doc;
    undoRunChanges();
    expect(docStore().doc).toBe(before);
    expect(useAgentStore.getState().transactionCount).toBe(2);
  });

  test("refuses when a foreign transaction sits among the newest entries", () => {
    runTwoSteps();
    // The user undid one agent step and made a new edit: counts no longer line up.
    docStore().undo();
    docStore().commit([insertRect()], { source: "user" });
    expect(canUndoRunChanges()).toBe(false);
  });

  test("nothing to undo before any run change", () => {
    expect(canUndoRunChanges()).toBe(false);
  });
});
