/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@/persistence/file-format";
import { useDocumentStore } from "@/store/use-document-store";
import { sessionTurns, useAgentStore } from "@/agent/use-agent-store";
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

const agent = () => useAgentStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

let stop: () => void = () => {};
let docId = "";

beforeEach(async () => {
  setSessionBackend(createMemorySessionBackend());
  agent().loadSession(emptySession());
  agent().set({ status: "idle" });
  const doc = createEmptyDocument();
  docId = doc.id;
  useDocumentStore.getState().load(doc);
  stop = startSessionSync();
  await settle();
});
afterEach(() => stop());

/** One complete run as the runtimes produce it in the store. */
const runTurn = async (prompt: string, reply: string) => {
  agent().beginRun(crypto.randomUUID(), prompt);
  agent().appendLog({ kind: "user", text: prompt });
  agent().appendLog({ kind: "assistant", text: reply });
  agent().set({ status: "done" });
  await settle();
};

describe("session sync", () => {
  test("a run is written when it starts (as cancelled) and when it ends", async () => {
    agent().beginRun("r1", "first");
    agent().appendLog({ kind: "user", text: "first" });
    await settle();
    expect((await listSessions(docId))[0]?.turns[0]?.status).toBe("cancelled");
    agent().appendLog({ kind: "assistant", text: "ok" });
    agent().set({ status: "done" });
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
    expect(sessionTurns(agent()).map((t) => t.log[0]?.text)).toEqual(["one", "two"]);
    expect(agent().turns).toHaveLength(1);
    expect((await listSessions(docId))[0]?.turns).toHaveLength(2);
  });

  test("new chat and switching keep each session's turns", async () => {
    await runTurn("alpha", "a");
    const alpha = agent().sessionId;
    await startNewSession();
    expect(agent().turns).toEqual([]);
    expect(agent().log).toEqual([]);
    await runTurn("beta", "b");
    expect(
      useSessionsStore
        .getState()
        .items.map((i) => i.title)
        .sort(),
    ).toEqual(["alpha", "beta"]);

    await switchSession(alpha);
    expect(agent().sessionId).toBe(alpha);
    expect(sessionTurns(agent()).map((t) => t.log[0]?.text)).toEqual(["alpha"]);
    expect(agent().status).toBe("idle");
  });

  test("switching or creating is refused while a run is active", async () => {
    await runTurn("alpha", "a");
    const alpha = agent().sessionId;
    await startNewSession();
    await runTurn("beta", "b");
    agent().beginRun("r9", "busy");
    agent().appendLog({ kind: "user", text: "busy" });
    const before = agent().sessionId;
    await switchSession(alpha);
    await startNewSession();
    expect(agent().sessionId).toBe(before);
    agent().set({ status: "done" });
  });

  test("switching does not reorder the list", async () => {
    await runTurn("alpha", "a");
    const alpha = agent().sessionId;
    await startNewSession();
    await runTurn("beta", "b");
    const order = useSessionsStore.getState().items.map((i) => i.id);
    await switchSession(alpha);
    await startNewSession();
    expect(useSessionsStore.getState().items.map((i) => i.id)).toEqual(order);
  });

  test("deleting the open session falls back to the newest remaining one", async () => {
    await runTurn("alpha", "a");
    const alpha = agent().sessionId;
    await startNewSession();
    await runTurn("beta", "b");
    await removeSession(agent().sessionId);
    expect(agent().sessionId).toBe(alpha);
    expect((await listSessions(docId)).map((s) => s.title)).toEqual(["alpha"]);
    await removeSession(alpha);
    expect(agent().turns).toEqual([]);
    expect(await listSessions(docId)).toEqual([]);
  });

  test("rename sets a custom title; empty goes back to the first prompt", async () => {
    await runTurn("alpha", "a");
    await renameSession(agent().sessionId, "Landing v2");
    expect((await listSessions(docId))[0]?.title).toBe("Landing v2");
    await renameSession(agent().sessionId, "  ");
    expect((await listSessions(docId))[0]?.title).toBe("alpha");
  });

  test("opening another file shows that file's newest session or an empty one", async () => {
    await runTurn("alpha", "a");
    const first = docId;
    const other = createEmptyDocument();
    useDocumentStore.getState().load(other);
    await settle();
    expect(useSessionsStore.getState().docId).toBe(other.id);
    expect(agent().turns).toEqual([]);
    expect(agent().log).toEqual([]);
    expect(useSessionsStore.getState().items).toEqual([]);

    const back = (await listSessions(first))[0];
    useDocumentStore.getState().load({ ...createEmptyDocument(), id: first });
    await settle();
    expect(agent().sessionId).toBe(back?.id ?? "");
    expect(sessionTurns(agent())[0]?.log[0]?.text).toBe("alpha");
  });
});
