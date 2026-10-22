/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { OpError } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { answerPendingDecision, cancelPendingDecisions, RunCancelledError } from "./decisions";
import { insertRect, resetStores } from "./test-utils";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

const past = () => useDocumentStore.getState().history.past;

beforeEach(resetStores);

describe("applyOps grouping", () => {
  test("ops of one step share one agent transaction", () => {
    const host = createToolHost();
    host.applyOps([insertRect()]);
    host.applyOps([insertRect()]);
    host.applyOps([insertRect()]);
    expect(past()).toHaveLength(1);
    expect(past()[0]?.source).toBe("agent");
    expect(past()[0]?.ops).toHaveLength(3);
    expect(useAgentStore.getState().transactionCount).toBe(1);
  });

  test("a user edit in between starts a new transaction", () => {
    const host = createToolHost();
    host.applyOps([insertRect()]);
    useDocumentStore.getState().commit([insertRect()], { source: "user" });
    host.applyOps([insertRect()]);
    expect(past().map((tx) => tx.source)).toEqual(["agent", "user", "agent"]);
    expect(past()[1]?.ops).toHaveLength(1);
    expect(useAgentStore.getState().transactionCount).toBe(2);
  });

  test("a step boundary starts a new transaction labelled with the step title", () => {
    useAgentStore.getState().setPlan([
      { id: "s1", title: "Build header" },
      { id: "s2", title: "Build footer" },
    ]);
    const host = createToolHost();
    host.reportStep("s1", "running");
    host.applyOps([insertRect()]);
    host.reportStep("s1", "done");
    host.reportStep("s2", "running");
    host.applyOps([insertRect()]);
    expect(past().map((tx) => tx.label)).toEqual(["Build header", "Build footer"]);
    expect(useAgentStore.getState().transactionCount).toBe(2);
  });

  test("rethrows OpError and leaves document and history untouched", () => {
    const host = createToolHost();
    const before = useDocumentStore.getState().doc;
    expect(() => host.applyOps([{ op: "delete", id: "missing" }])).toThrow(OpError);
    expect(useDocumentStore.getState().doc).toBe(before);
    expect(past()).toHaveLength(0);
    expect(useAgentStore.getState().transactionCount).toBe(0);
  });

  test("setFocus writes focusIds", () => {
    createToolHost().setFocus(["rect-1"]);
    expect(useAgentStore.getState().focusIds).toEqual(["rect-1"]);
  });
});

describe("askUser", () => {
  test("shows a decision, waits, resolves with the answer", async () => {
    const host = createToolHost();
    const answer = host.askUser({ question: "Dark or light?", options: ["Dark", "Light"] });
    const { decision, status } = useAgentStore.getState();
    expect(status).toBe("awaiting_decision");
    expect(decision?.question).toBe("Dark or light?");
    expect(answerPendingDecision(decision!.id, "Dark")).toBe(true);
    expect(await answer).toBe("Dark");
    expect(useAgentStore.getState().decision).toBeNull();
    expect(useAgentStore.getState().status).toBe("running");
  });

  test("stale decision ids are ignored", () => {
    expect(answerPendingDecision("decision-nope", "x")).toBe(false);
  });

  test("cancel rejects the pending promise", async () => {
    const answer = createToolHost().askUser({ question: "?", options: ["a"] });
    cancelPendingDecisions();
    await expect(answer).rejects.toBeInstanceOf(RunCancelledError);
    expect(useAgentStore.getState().decision).toBeNull();
  });
});
