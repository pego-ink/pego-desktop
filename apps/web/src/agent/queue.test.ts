/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MAX_CONCURRENT_RUNS, type EditorToBridge, type RunAttachment } from "@pego/agent";
import {
  advanceQueues,
  editQueued,
  queueDeps,
  removeQueued,
  resetQueueState,
  steerNow,
  steerQueued,
  submitPrompt,
} from "./queue";
import { createBridgeHandlers } from "./bridge-handlers";
import { allRuns, getRun, registerRun, runsForSession, unregisterRun } from "./run-registry";
import { createSteerInbox } from "./steer-inbox";
import { emptySession } from "./sessions/session-model";
import { resetStores } from "./test-utils";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

const agent = () => useAgentStore.getState();
const live = (id: string) => agent().liveSessions[id]!;

const image = (id: string): RunAttachment => ({
  id,
  name: `${id}.png`,
  mediaType: "image/png",
  data: "AAAA",
});

type Started = {
  sessionId: string;
  text: string;
  attachments: unknown;
  steered: boolean;
  displayText?: string;
};
let started: Started[] = [];
let cancelled: string[] = [];
let sent: EditorToBridge[] = [];
let runSeq = 0;

/** Registers a run synchronously, like the real startRun does; it stays "running" until ended. */
const fakeStartRun: typeof queueDeps.startRun = async (text, options = {}) => {
  const sessionId = options.sessionId ?? agent().visibleSessionId;
  started.push({
    sessionId,
    text,
    attachments: options.attachments,
    steered: options.steered === true,
    displayText: options.displayText,
  });
  const runId = `fake-${++runSeq}`;
  agent().beginRun(sessionId, runId, text);
  agent().patchSession(sessionId, { status: "running" });
  registerRun({
    id: runId,
    sessionId,
    backend: "api",
    controller: new AbortController(),
    host: createToolHost({ runId }),
    styleId: undefined,
  });
  return runId;
};

/** End the session's run the way the runtimes do: status first, then the registry entry. */
const endRun = (sessionId: string, status: "done" | "failed" | "cancelled") => {
  agent().patchSession(sessionId, { status });
  for (const run of runsForSession(sessionId)) unregisterRun(run.id);
};

/** A running in-browser run in a session, with a steer inbox. */
const registerInBrowserRun = (sessionId: string, runId: string) => {
  agent().beginRun(sessionId, runId, "p");
  agent().patchSession(sessionId, { status: "running" });
  const attachments: RunAttachment[] = [image("att-1")];
  const steerInbox = createSteerInbox((m) => agent().setSteered(sessionId, m.id, "delivered"));
  registerRun({
    id: runId,
    sessionId,
    backend: "api",
    controller: new AbortController(),
    host: createToolHost({ runId, attachments }),
    styleId: undefined,
    steerInbox,
    attachments,
  });
  return { steerInbox, attachments };
};

const original = { ...queueDeps };

beforeEach(() => {
  resetStores();
  // resetStores leaves a "run-test" running in the visible session; these tests start clean.
  unregisterRun("run-test");
  agent().patchSession(agent().visibleSessionId, { status: "idle", runId: null, log: [] });
  resetQueueState();
  started = [];
  cancelled = [];
  sent = [];
  runSeq = 0;
  queueDeps.startRun = fakeStartRun;
  queueDeps.cancelRun = (runId) => {
    cancelled.push(runId);
    const run = getRun(runId);
    if (run) {
      agent().patchSession(run.sessionId, { status: "cancelled" });
      unregisterRun(runId);
    }
  };
  queueDeps.sendToBridge = (message) => {
    sent.push(message);
    return true;
  };
});

afterEach(() => {
  Object.assign(queueDeps, original);
});

const sid = () => agent().visibleSessionId;

describe("submitPrompt", () => {
  test("starts a run when the session is idle", () => {
    expect(submitPrompt(sid(), "  make a card ")).toBe("started");
    expect(started).toHaveLength(1);
    expect(started[0]?.text).toBe("make a card");
    expect(live(sid()).queue).toHaveLength(0);
  });

  test("never lets startRun fall back to the composer images", () => {
    submitPrompt(sid(), "hi");
    expect(started[0]?.attachments).toEqual([]);
  });

  test("queues behind the running run of the same session", () => {
    submitPrompt(sid(), "first");
    expect(submitPrompt(sid(), "second", { attachments: [image("att-1")] })).toBe("queued");
    expect(started).toHaveLength(1);
    expect(live(sid()).queue.map((m) => m.text)).toEqual(["second"]);
    expect(live(sid()).queue[0]?.attachments).toHaveLength(1);
  });

  test("refuses empty text and unknown sessions", () => {
    expect(submitPrompt(sid(), "   ")).toBe("refused");
    expect(submitPrompt("nope", "hi")).toBe("refused");
    expect(started).toHaveLength(0);
  });

  test("when every slot is taken the prompt waits and starts once a run ends", () => {
    const others = Array.from({ length: MAX_CONCURRENT_RUNS }, (_, i) => `other-${i}`);
    for (const id of others) {
      agent().showSession(emptySession(id));
      submitPrompt(id, "busy");
    }
    expect(allRuns()).toHaveLength(MAX_CONCURRENT_RUNS);
    agent().showSession(emptySession("late"));
    expect(submitPrompt("late", "waiting")).toBe("queued");
    expect(live("late").queue.map((m) => m.text)).toEqual(["waiting"]);

    advanceQueues();
    expect(started.some((s) => s.text === "waiting")).toBe(false);

    endRun("other-0", "done");
    advanceQueues();
    expect(started.at(-1)).toMatchObject({ sessionId: "late", text: "waiting" });
    expect(live("late").queue).toHaveLength(0);
  });
});

describe("auto-advance", () => {
  test("a finished run starts the first queued message, in order", () => {
    submitPrompt(sid(), "one");
    submitPrompt(sid(), "two");
    submitPrompt(sid(), "three");
    endRun(sid(), "done");
    advanceQueues();
    expect(started.map((s) => s.text)).toEqual(["one", "two"]);
    expect(live(sid()).queue.map((m) => m.text)).toEqual(["three"]);
    advanceQueues(); // running again: nothing more
    expect(started).toHaveLength(2);
  });

  test("a failed run advances too", () => {
    submitPrompt(sid(), "one");
    submitPrompt(sid(), "two");
    endRun(sid(), "failed");
    advanceQueues();
    expect(started.map((s) => s.text)).toEqual(["one", "two"]);
  });

  test("a run the user cancelled keeps its queue", () => {
    submitPrompt(sid(), "one");
    submitPrompt(sid(), "two");
    endRun(sid(), "cancelled");
    advanceQueues();
    expect(started).toHaveLength(1);
    expect(live(sid()).queue.map((m) => m.text)).toEqual(["two"]);
  });

  test("waits while the registry entry is still there", () => {
    submitPrompt(sid(), "one");
    submitPrompt(sid(), "two");
    agent().patchSession(sid(), { status: "done" }); // status flips before unregister
    advanceQueues();
    expect(started).toHaveLength(1);
  });

  test("a restored queue (idle session) does not start by itself", () => {
    agent().patchSession(sid(), {
      queue: [{ id: "q", text: "old", attachments: [], createdAt: 1 }],
    });
    advanceQueues();
    expect(started).toHaveLength(0);
  });
});

describe("edit and remove", () => {
  test("edit changes the text, keeps order and rejects empty text", () => {
    submitPrompt(sid(), "run");
    submitPrompt(sid(), "a");
    submitPrompt(sid(), "b");
    const [a, b] = live(sid()).queue;
    expect(editQueued(sid(), a!.id, "  a2 ")).toBe(true);
    expect(editQueued(sid(), b!.id, "   ")).toBe(false);
    expect(editQueued(sid(), "missing", "x")).toBe(false);
    expect(live(sid()).queue.map((m) => m.text)).toEqual(["a2", "b"]);
  });

  test("remove drops one message", () => {
    submitPrompt(sid(), "run");
    submitPrompt(sid(), "a");
    submitPrompt(sid(), "b");
    removeQueued(sid(), live(sid()).queue[0]!.id);
    expect(live(sid()).queue.map((m) => m.text)).toEqual(["b"]);
  });
});

describe("steer", () => {
  test("in-browser: lands in the inbox with a pending bubble, delivered on drain", () => {
    const { steerInbox, attachments } = registerInBrowserRun(sid(), "r1");
    expect(steerNow(sid(), " go left ", [image("att-1")])).toBe("steered");
    expect(steerInbox.pending()).toBe(1);
    const bubble = live(sid()).log.find((e) => e.steered);
    expect(bubble).toMatchObject({ kind: "user", text: "go left", steered: "pending" });
    // The image got an id the run's tool host does not know yet.
    expect(attachments.map((a) => a.id)).toEqual(["att-1", "att-2"]);
    expect(bubble?.attachments?.[0]?.id).toBe("att-2");

    const [drained] = steerInbox.drain();
    expect(drained?.text).toBe("go left");
    expect(live(sid()).log.find((e) => e.id === bubble?.id)?.steered).toBe("delivered");
    expect(cancelled).toHaveLength(0);
  });

  test("steerQueued moves the message out of the queue into the run", () => {
    const { steerInbox } = registerInBrowserRun(sid(), "r1");
    submitPrompt(sid(), "later");
    const id = live(sid()).queue[0]!.id;
    expect(steerQueued(sid(), id)).toBe("steered");
    expect(live(sid()).queue).toHaveLength(0);
    expect(steerInbox.pending()).toBe(1);
    expect(steerQueued(sid(), id)).toBe("refused");
  });

  test("native local agent: sends run_steer, delivered on the bridge event", () => {
    agent().beginRun(sid(), "loc", "p");
    agent().patchSession(sid(), { status: "running" });
    registerRun({
      id: "loc",
      sessionId: sid(),
      backend: "local",
      controller: new AbortController(),
      host: createToolHost({ runId: "loc" }),
      styleId: undefined,
      steerMode: "native",
    });
    expect(steerNow(sid(), "turn blue")).toBe("steered");
    expect(sent).toEqual([{ type: "run_steer", runId: "loc", text: "turn blue" }]);
    expect(live(sid()).log.at(-1)?.steered).toBe("pending");
    expect(cancelled).toHaveLength(0);

    const handlers = createBridgeHandlers({ send: () => true });
    void handlers.handleMessage({
      type: "run_event",
      runId: "loc",
      event: { kind: "steered", text: "turn blue" },
    });
    expect(live(sid()).log.at(-1)?.steered).toBe("delivered");
  });

  test("native: a failed send marks the bubble", () => {
    queueDeps.sendToBridge = () => false;
    agent().beginRun(sid(), "loc", "p");
    agent().patchSession(sid(), { status: "running" });
    registerRun({
      id: "loc",
      sessionId: sid(),
      backend: "local",
      controller: new AbortController(),
      host: createToolHost({ runId: "loc" }),
      styleId: undefined,
      steerMode: "native",
    });
    steerNow(sid(), "turn blue");
    expect(live(sid()).log.at(-1)?.steered).toBe("failed");
  });

  test("restart local agent: cancels, then starts a new steered run in the same session", async () => {
    agent().beginRun(sid(), "loc", "p");
    agent().patchSession(sid(), { status: "running" });
    registerRun({
      id: "loc",
      sessionId: sid(),
      backend: "local",
      controller: new AbortController(),
      host: createToolHost({ runId: "loc" }),
      styleId: undefined,
      steerMode: "restart",
    });
    expect(steerNow(sid(), "different idea", [image("att-1")])).toBe("steered");
    expect(sent).toHaveLength(0);
    expect(cancelled).toEqual(["loc"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([
      {
        sessionId: sid(),
        text: "different idea",
        attachments: [image("att-1")],
        steered: true,
      },
    ]);
  });

  test("with no run it behaves like submitPrompt", () => {
    expect(steerNow(sid(), "hello")).toBe("started");
    expect(started).toHaveLength(1);
  });
});

describe("displayText", () => {
  test("the agent gets text, the bubble and queue chip use displayText", () => {
    submitPrompt(sid(), "Target layers (a)\n\nmake it red", { displayText: "make it red" });
    expect(started[0]).toMatchObject({ text: "Target layers (a)\n\nmake it red" });
    expect(started[0]?.displayText).toBe("make it red");
    submitPrompt(sid(), "ctx two", { displayText: "two" });
    expect(live(sid()).queue[0]).toMatchObject({ text: "ctx two", displayText: "two" });
    const id = live(sid()).queue[0]!.id;
    editQueued(sid(), id, "edited");
    expect(live(sid()).queue[0]?.displayText).toBeUndefined();
    expect(live(sid()).queue[0]?.text).toBe("edited");
  });
});
