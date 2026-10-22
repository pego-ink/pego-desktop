/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@/persistence/file-format";
import { useDocumentStore } from "@/store/use-document-store";
import { clearRuns, registerRun } from "@/agent/run-registry";
import { createToolHost } from "@/agent/tool-host";
import { runScope, sessionTurns, useAgentStore, visibleSession } from "@/agent/use-agent-store";
import { createMemorySessionBackend, listSessions, setSessionBackend } from "./session-db";
import {
  removeSession,
  renameSession,
  startNewSession,
  startSessionSync,
  switchSession,
} from "./session-sync";
import { emptySession } from "./session-model";
import { useSessionsStore } from "./use-sessions-store";
import {
  activateWorkspace,
  newDocumentTab,
  useWorkspaceStore,
} from "@/workspace/use-workspace-store";
import { getRun } from "@/agent/run-registry";

const agent = () => useAgentStore.getState();
/** The session shown in the panel, and its id. */
const view = () => visibleSession(agent());
const sid = () => agent().visibleSessionId;
const visibleRun = () => runScope(null);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

let stop: () => void = () => {};
let docId = "";

beforeEach(async () => {
  setSessionBackend(createMemorySessionBackend());
  clearRuns();
  agent().resetSessions(emptySession());
  const doc = createEmptyDocument();
  docId = doc.id;
  useDocumentStore.getState().load(doc);
  stop = startSessionSync();
  await settle();
});
afterEach(() => stop());

/** One complete run as the runtimes produce it in the store. */
const runTurn = async (prompt: string, reply: string) => {
  agent().beginRun(sid(), crypto.randomUUID(), prompt);
  visibleRun().appendLog({ kind: "user", text: prompt });
  visibleRun().appendLog({ kind: "assistant", text: reply });
  visibleRun().set({ status: "done" });
  await settle();
};

/** A run that keeps working in the visible session (registered like a bridge-driven run). */
const startWorking = (runId: string, prompt: string) => {
  const sessionId = sid();
  agent().beginRun(sessionId, runId, prompt);
  visibleRun().appendLog({ kind: "user", text: prompt });
  registerRun({
    id: runId,
    sessionId,
    backend: "local",
    controller: new AbortController(),
    host: createToolHost({ runId }),
    styleId: undefined,
  });
  agent().patchSession(sessionId, { status: "running" });
  return sessionId;
};

describe("session sync", () => {
  test("a run is written when it starts (as cancelled) and when it ends", async () => {
    agent().beginRun(sid(), "r1", "first");
    visibleRun().appendLog({ kind: "user", text: "first" });
    await settle();
    expect((await listSessions(docId))[0]?.turns[0]?.status).toBe("cancelled");
    visibleRun().appendLog({ kind: "assistant", text: "ok" });
    visibleRun().set({ status: "done" });
    await settle();
    const [stored] = await listSessions(docId);
    expect(stored?.title).toBe("first");
    expect(stored?.turns[0]).toMatchObject({ status: "done" });
    expect(useSessionsStore.getState().items.map((i) => i.title)).toEqual(["first"]);
  });

  test("an empty session is never stored", async () => {
    await startNewSession();
    expect(await listSessions(docId)).toEqual([]);
  });

  test("turns accumulate in one session", async () => {
    await runTurn("one", "reply one");
    await runTurn("two", "reply two");
    expect(sessionTurns(view()).map((t) => t.log[0]?.text)).toEqual(["one", "two"]);
    expect(view().turns).toHaveLength(1);
    expect((await listSessions(docId))[0]?.turns).toHaveLength(2);
  });

  test("new chat and switching keep each session's turns", async () => {
    await runTurn("alpha", "a");
    const alpha = sid();
    await startNewSession();
    expect(view().turns).toEqual([]);
    expect(view().log).toEqual([]);
    await runTurn("beta", "b");
    expect(
      useSessionsStore
        .getState()
        .items.map((i) => i.title)
        .sort(),
    ).toEqual(["alpha", "beta"]);

    await switchSession(alpha);
    expect(sid()).toBe(alpha);
    expect(sessionTurns(view()).map((t) => t.log[0]?.text)).toEqual(["alpha"]);
    expect(view().status).toBe("idle");
  });

  test("a running chat keeps running and saving in the background", async () => {
    await runTurn("alpha", "a");
    const alpha = startWorking("r9", "busy");
    await startNewSession();
    expect(sid()).not.toBe(alpha);
    expect(agent().liveSessions[alpha]?.status).toBe("running");

    // The background run still writes into its own session and is stored when it ends.
    runScope("r9").appendLog({ kind: "assistant", text: "done in the back" });
    runScope("r9").set({ status: "done" });
    await settle();
    const stored = (await listSessions(docId)).find((s) => s.id === alpha);
    expect(stored?.turns.at(-1)).toMatchObject({ status: "done" });
    expect(view().log).toEqual([]);

    // Switching back shows the live state, then leaving an idle chat drops it from memory.
    await switchSession(alpha);
    expect(view().log.map((l) => l.text)).toEqual(["busy", "done in the back"]);
    await startNewSession();
    expect(agent().liveSessions[alpha]).toBeUndefined();
  });

  test("deleting a chat with a working run stops the run first", async () => {
    await runTurn("alpha", "a");
    const alpha = startWorking("r7", "busy");
    await startNewSession();
    await removeSession(alpha);
    expect(agent().liveSessions[alpha]).toBeUndefined();
    expect((await listSessions(docId)).some((s) => s.id === alpha)).toBe(false);
  });

  test("switching does not reorder the list", async () => {
    await runTurn("alpha", "a");
    const alpha = sid();
    await startNewSession();
    await runTurn("beta", "b");
    const order = useSessionsStore.getState().items.map((i) => i.id);
    await switchSession(alpha);
    await startNewSession();
    expect(useSessionsStore.getState().items.map((i) => i.id)).toEqual(order);
  });

  test("deleting the open session falls back to the newest remaining one", async () => {
    await runTurn("alpha", "a");
    const alpha = sid();
    await startNewSession();
    await runTurn("beta", "b");
    await removeSession(sid());
    expect(sid()).toBe(alpha);
    expect((await listSessions(docId)).map((s) => s.title)).toEqual(["alpha"]);
    await removeSession(alpha);
    expect(view().turns).toEqual([]);
    expect(await listSessions(docId)).toEqual([]);
  });

  test("rename sets a custom title; empty goes back to the first prompt", async () => {
    await runTurn("alpha", "a");
    await renameSession(sid(), "Landing v2");
    expect((await listSessions(docId))[0]?.title).toBe("Landing v2");
    await renameSession(sid(), "  ");
    expect((await listSessions(docId))[0]?.title).toBe("alpha");
  });

  test("opening another file shows that file's newest session or an empty one", async () => {
    await runTurn("alpha", "a");
    const first = docId;
    const other = createEmptyDocument();
    useDocumentStore.getState().load(other);
    await settle();
    expect(useSessionsStore.getState().docId).toBe(other.id);
    expect(view().turns).toEqual([]);
    expect(view().log).toEqual([]);
    expect(useSessionsStore.getState().items).toEqual([]);

    const back = (await listSessions(first))[0];
    useDocumentStore.getState().load({ ...createEmptyDocument(), id: first });
    await settle();
    expect(sid()).toBe(back?.id ?? "");
    expect(sessionTurns(view())[0]?.log[0]?.text).toBe("alpha");
  });

  test("a run keeps working in a background tab; each tab shows its own chats", async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: "tab-a", kind: "local", name: "A", dir: null, saved: null }],
      liveId: "tab-a",
      view: "editor",
    });
    await settle();
    await runTurn("alpha", "a");
    const alpha = startWorking("run-a", "busy");

    const tabB = newDocumentTab();
    await settle();
    const docB = useDocumentStore.getState().doc.id;
    expect(useSessionsStore.getState()).toMatchObject({ docId: docB, items: [] });
    expect(sid()).not.toBe(alpha);
    expect(getRun("run-a")).toBeDefined();
    expect(agent().liveSessions[alpha]?.status).toBe("running");
    await runTurn("beta", "b");
    expect((await listSessions(docB)).map((s) => s.title)).toEqual(["beta"]);

    // Back in A: its running chat is shown again, with A's list.
    activateWorkspace("tab-a");
    await settle();
    expect(sid()).toBe(alpha);
    expect(useSessionsStore.getState().docId).toBe(docId);
    expect(useSessionsStore.getState().items.map((i) => i.title)).toEqual(["alpha"]);

    // The run ends while B is shown: stored under A's document, not B's.
    activateWorkspace(tabB);
    await settle();
    runScope("run-a").set({ status: "done" });
    await settle();
    expect((await listSessions(docId)).find((s) => s.id === alpha)?.turns.at(-1)).toMatchObject({
      status: "done",
    });
    expect((await listSessions(docB)).some((s) => s.id === alpha)).toBe(false);
  });

  test("the queue is stored with the session and survives a reload", async () => {
    await runTurn("alpha", "a");
    const alpha = sid();
    // Cancelled runs keep their queue (a finished one would start it right away).
    agent().patchSession(alpha, {
      status: "cancelled",
      queue: [
        {
          id: "q1",
          text: "next thing",
          attachments: [{ id: "att-1", name: "a.png", mediaType: "image/png", data: "AAAA" }],
          createdAt: 1,
        },
      ],
    });
    await settle();
    expect((await listSessions(docId))[0]?.queue?.[0]).toMatchObject({
      text: "next thing",
      attachments: [{ name: "a.png", size: 3 }],
    });

    // Reload: nothing in memory, the session comes back from storage with its queue.
    agent().resetSessions(emptySession());
    await switchSession(alpha);
    expect(sid()).toBe(alpha);
    expect(view().queue[0]).toMatchObject({
      text: "next thing",
      attachments: [],
      attachmentsMeta: [{ name: "a.png", size: 3 }],
    });
    // A restored queue does not start by itself.
    await settle();
    expect(view().status).toBe("idle");
    expect(view().queue).toHaveLength(1);
  });
});
