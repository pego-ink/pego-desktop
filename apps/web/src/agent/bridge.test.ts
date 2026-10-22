/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import type { BridgeToEditor, EditorToBridge, LocalAgentInfo } from "@pego/agent";
import { useDocumentStore } from "@/store/use-document-store";
import { setActiveRun } from "./active-run";
import { createBridgeClient, parseBridgeMessage, type SocketLike } from "./bridge-client";
import { createBridgeHandlers, MCP_LABEL } from "./bridge-handlers";
import { resetStores } from "./test-utils";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = (data: string) => void this.sent.push(data);
  close = () => {
    this.closed = true;
    this.onclose?.();
  };
  receive = (message: unknown) => this.onmessage?.({ data: JSON.stringify(message) });
}

const CODEX: LocalAgentInfo = {
  id: "codex",
  name: "Codex",
  installed: true,
  version: "0.9.0",
  supportsModels: true,
};

const state = () => useAgentStore.getState();
const past = () => useDocumentStore.getState().history.past;

const insertCall = (
  callId: string,
  source: Extract<BridgeToEditor, { type: "tool_call" }>["source"],
) =>
  ({
    type: "tool_call",
    callId,
    tool: "update_node",
    input: { id: "rect-1", props: { fill: `#00000${callId}` } },
    source,
  }) satisfies BridgeToEditor;

beforeEach(resetStores);

describe("bridge client", () => {
  const setup = () => {
    const sockets: FakeSocket[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const messages: BridgeToEditor[] = [];
    let closed = 0;
    const client = createBridgeClient({
      url: "ws://test",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      documentName: () => "doc.pego",
      onMessage: (m) => messages.push(m),
      onClosed: () => closed++,
      backoff: (attempt) => 100 * (attempt + 1),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    return { client, sockets, timers, messages, closedCount: () => closed };
  };

  test("sends hello on open and forwards valid messages only", () => {
    const { client, sockets, messages } = setup();
    client.start();
    sockets[0]!.onopen?.();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({
      type: "hello",
      protocol: 3,
      documentName: "doc.pego",
    });
    expect(client.isOpen()).toBe(true);

    sockets[0]!.receive({
      type: "welcome",
      protocol: 3,
      claudeCodeAvailable: true,
      mcpUrl: "http://x",
      agents: [],
    });
    sockets[0]!.receive({ type: "tool_call", callId: 5 }); // malformed
    sockets[0]!.onmessage?.({ data: "not json" });
    sockets[0]!.onmessage?.({ data: new ArrayBuffer(2) });
    expect(messages.map((m) => m.type)).toEqual(["welcome"]);
  });

  test("reconnects quietly with growing backoff and resets after a connection", () => {
    const { client, sockets, timers } = setup();
    client.start();
    sockets[0]!.onclose?.(); // bridge not running: closed before ever opening
    expect(timers.map((t) => t.ms)).toEqual([100]);
    timers.shift()!.fn();
    sockets[1]!.onclose?.();
    expect(timers.map((t) => t.ms)).toEqual([200]);
    timers.shift()!.fn();
    sockets[2]!.onopen?.();
    sockets[2]!.onclose?.();
    expect(timers.map((t) => t.ms)).toEqual([100]);
  });

  test("stop closes and never reconnects; send reports a closed socket", () => {
    const { client, sockets, timers, closedCount } = setup();
    client.start();
    sockets[0]!.onopen?.();
    client.stop();
    expect(sockets[0]!.closed).toBe(true);
    expect(timers).toHaveLength(0);
    expect(closedCount()).toBe(1);
    expect(client.send({ type: "run_cancel", runId: "r" })).toBe(false);
  });

  test("sends focus on window focus and when the page becomes visible, only while connected", () => {
    const listeners = new Map<string, () => void>();
    const target = {
      visibilityState: "hidden",
      addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
    const sockets: FakeSocket[] = [];
    const client = createBridgeClient({
      url: "ws://test",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      documentName: () => "doc.pego",
      onMessage: () => {},
      onClosed: () => {},
      setTimer: () => 0,
      clearTimer: () => {},
      windowTarget: target,
      documentTarget: target,
    });
    client.start();
    const socket = sockets[0] as FakeSocket;
    listeners.get("focus")?.();
    expect(socket.sent).toHaveLength(0); // not open yet
    socket.onopen?.();
    listeners.get("focus")?.();
    target.visibilityState = "hidden";
    listeners.get("visibilitychange")?.();
    target.visibilityState = "visible";
    listeners.get("visibilitychange")?.();
    expect(socket.sent.slice(1).map((s) => JSON.parse(s))).toEqual([
      { type: "focus" },
      { type: "focus" },
    ]);
    client.stop();
    expect(listeners.size).toBe(0);
  });

  test("parseBridgeMessage handles v3 welcome, agents and models", () => {
    const parse = (value: unknown) => parseBridgeMessage(JSON.stringify(value));
    expect(
      parse({
        type: "welcome",
        protocol: 3,
        claudeCodeAvailable: false,
        mcpUrl: "u",
        agents: [CODEX, { id: "nope", name: "x", installed: true, supportsModels: false }, 7],
      }),
    ).toMatchObject({ type: "welcome", agents: [CODEX] });
    // A welcome without agents still parses (older bridge): empty list.
    expect(
      parse({ type: "welcome", protocol: 2, claudeCodeAvailable: true, mcpUrl: "u" }),
    ).toMatchObject({ agents: [] });
    expect(parse({ type: "agents", agents: [CODEX] })).toEqual({ type: "agents", agents: [CODEX] });
    expect(parse({ type: "agents", agents: "x" })).toBeNull();
    expect(parse({ type: "models", agentId: "codex", models: ["a", "b"] })).toEqual({
      type: "models",
      agentId: "codex",
      models: ["a", "b"],
    });
    expect(parse({ type: "models", agentId: "codex", models: [], error: "boom" })).toMatchObject({
      error: "boom",
    });
    expect(parse({ type: "models", agentId: "bogus", models: [] })).toBeNull();
    expect(parse({ type: "models", agentId: "codex", models: [1] })).toBeNull();
  });

  test("parseBridgeMessage rejects unknown types", () => {
    expect(parseBridgeMessage(JSON.stringify({ type: "evil" }))).toBeNull();
  });
});

describe("bridge handlers", () => {
  const setup = (startAt = 10_000) => {
    const sent: EditorToBridge[] = [];
    let now = startAt;
    const handlers = createBridgeHandlers({
      send: (m) => {
        sent.push(m);
        return true;
      },
      now: () => now,
    });
    return { handlers, sent, advance: (ms: number) => (now += ms) };
  };

  test("welcome updates bridge status; closing resets it", async () => {
    const { handlers } = setup();
    await handlers.handleMessage({
      type: "welcome",
      protocol: 3,
      claudeCodeAvailable: true,
      mcpUrl: "http://m",
      agents: [CODEX],
    });
    expect(state().bridge).toEqual({
      connected: true,
      claudeCodeAvailable: true,
      mcpUrl: "http://m",
      agents: [CODEX],
    });
    handlers.handleClosed();
    expect(state().bridge.connected).toBe(false);
  });

  test("mcp calls: separate transactions after 2s, extended within 2s, labelled Claude Code", async () => {
    const { handlers, sent, advance } = setup();
    await handlers.handleMessage(insertCall("1", { kind: "mcp" }));
    advance(500);
    await handlers.handleMessage(insertCall("2", { kind: "mcp" }));
    expect(past()).toHaveLength(1);
    advance(5_000);
    await handlers.handleMessage(insertCall("3", { kind: "mcp" }));
    expect(past()).toHaveLength(2);
    expect(past().map((t) => [t.label, t.source])).toEqual([
      [MCP_LABEL, "agent"],
      [MCP_LABEL, "agent"],
    ]);
    expect(sent.map((m) => m.type === "tool_result" && [m.callId, m.isError])).toEqual([
      ["1", false],
      ["2", false],
      ["3", false],
    ]);
    // Activity is visible: log entries and focus, but no run-level transaction count.
    expect(state().log.filter((l) => l.kind === "tool")).toHaveLength(3);
    expect(state().focusIds).toEqual(["rect-1"]);
    expect(state().transactionCount).toBe(0);
  });

  test("tool_result carries images from the tool result", async () => {
    const image = { mediaType: "image/png" as const, data: "AAAA", width: 2, height: 1 };
    const sent: EditorToBridge[] = [];
    const handlers = createBridgeHandlers({
      send: (m) => (sent.push(m), true),
      findTool: () => ({
        name: "shot",
        description: "",
        inputSchema: {},
        run: async () => ({ content: "ok", isError: false, images: [image] }),
      }),
    });
    await handlers.handleMessage({
      type: "tool_call",
      callId: "img",
      tool: "shot",
      input: {},
      source: { kind: "mcp" },
    });
    await handlers.handleMessage({
      type: "tool_call",
      callId: "plain",
      tool: "shot",
      input: {},
      source: { kind: "mcp" },
    });
    expect(sent[0]).toEqual({
      type: "tool_result",
      callId: "img",
      content: "ok",
      isError: false,
      images: [image],
    });
  });

  test("tool errors and unknown tools reply with isError", async () => {
    const { handlers, sent } = setup();
    await handlers.handleMessage({ ...insertCall("1", { kind: "mcp" }), tool: "nope" });
    await handlers.handleMessage({
      ...insertCall("2", { kind: "mcp" }),
      input: { id: "missing", props: { fill: "#fff" } },
    });
    expect(sent).toMatchObject([
      { type: "tool_result", callId: "1", isError: true },
      { type: "tool_result", callId: "2", isError: true },
    ]);
    expect(past()).toHaveLength(0);
  });

  test("run-sourced calls need the matching active claude-code run", async () => {
    const { handlers, sent } = setup();
    await handlers.handleMessage(insertCall("1", { kind: "run", runId: "r1" }));
    expect(sent[0]).toMatchObject({ isError: true });

    setActiveRun({
      id: "r1",
      backend: "local",
      controller: new AbortController(),
      host: createToolHost(),
    });
    await handlers.handleMessage(insertCall("2", { kind: "run", runId: "r1" }));
    expect(sent[1]).toMatchObject({ callId: "2", isError: false });
    expect(state().transactionCount).toBe(1);
  });

  test("run_event maps text, tools, usage and completion into the store", async () => {
    const { handlers } = setup();
    state().beginRun("r1", "p");
    setActiveRun({
      id: "r1",
      backend: "local",
      controller: new AbortController(),
      host: createToolHost(),
    });
    const event = (e: Extract<BridgeToEditor, { type: "run_event" }>["event"]) =>
      handlers.handleMessage({ type: "run_event", runId: "r1", event: e });

    await event({ kind: "text", text: "hello" });
    await event({ kind: "tool", tool: "insert_nodes", status: "started" });
    await event({ kind: "tool", tool: "insert_nodes", status: "finished", isError: true });
    await event({ kind: "usage", inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    expect(state().status).toBe("running");
    expect(state().log.map((l) => l.kind)).toEqual(["assistant", "tool", "tool"]);
    expect(state().usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.01 });

    await event({ kind: "done" });
    expect(state().status).toBe("done");
  });

  test("run_event error and a dropped connection fail the run", async () => {
    const { handlers } = setup();
    state().beginRun("r1", "p");
    const activate = () =>
      setActiveRun({
        id: "r1",
        backend: "local",
        controller: new AbortController(),
        host: createToolHost(),
      });
    activate();
    await handlers.handleMessage({
      type: "run_event",
      runId: "r1",
      event: { kind: "error", message: "boom" },
    });
    expect(state().status).toBe("failed");
    expect(state().log.at(-1)?.text).toBe("boom");

    state().beginRun("r2", "p");
    setActiveRun({
      id: "r2",
      backend: "local",
      controller: new AbortController(),
      host: createToolHost(),
    });
    handlers.handleClosed();
    expect(state().status).toBe("failed");
  });
});
