import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  agentTools,
  BRIDGE_PROTOCOL_VERSION,
  guides,
  type BridgeToEditor,
  type EditorToBridge,
  type RunEvent,
} from "@pego/agent";
import type { BridgeConfig } from "./config";
import { NO_EDITOR_MESSAGE } from "./editor-hub";
import { startBridge, type Bridge } from "./server";

const ORIGIN = "http://localhost:5173";
const ECHO_TOOL = {
  name: "test_echo",
  description: "Echo input",
  inputSchema: { properties: { text: { type: "string" } }, required: ["text"] },
  run: async () => ({ content: "unused", isError: false }),
};

const baseConfig = (overrides: Partial<BridgeConfig> = {}): BridgeConfig => ({
  port: 0,
  allowedOrigins: null,
  toolTimeoutMs: 60_000,
  log: () => undefined,
  ...overrides,
});

const bridges: Bridge[] = [];
const start = (overrides: Partial<BridgeConfig> = {}, extra: Record<string, unknown> = {}) => {
  const bridge = startBridge({ ...baseConfig(overrides), ...extra });
  bridges.push(bridge);
  return bridge;
};

type FakeEditor = {
  ws: WebSocket;
  inbox: BridgeToEditor[];
  send: (message: EditorToBridge) => void;
  next: (type: BridgeToEditor["type"]) => Promise<BridgeToEditor>;
  closed: Promise<{ code: number; reason: string }>;
};

const connect = async (bridge: Bridge, origin: string | null = ORIGIN): Promise<FakeEditor> => {
  const headers = origin ? { Origin: origin } : undefined;
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/editor`, { headers } as never);
  const inbox: BridgeToEditor[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    inbox.push(JSON.parse(String(event.data)) as BridgeToEditor);
    waiters.splice(0).forEach((wake) => wake());
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
  );
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws error")));
  });
  const next = async (type: BridgeToEditor["type"]) => {
    for (;;) {
      const index = inbox.findIndex((m) => m.type === type);
      if (index >= 0) return inbox.splice(index, 1)[0] as BridgeToEditor;
      await new Promise<void>((wake) => waiters.push(wake));
    }
  };
  return { ws, inbox, send: (m) => ws.send(JSON.stringify(m)), next, closed };
};

const greet = async (bridge: Bridge, name = "doc") => {
  const editor = await connect(bridge);
  editor.send({ type: "hello", protocol: BRIDGE_PROTOCOL_VERSION, documentName: name });
  const welcome = await editor.next("welcome");
  return { editor, welcome };
};

const mcpPost = (bridge: Bridge, body: unknown, headers: Record<string, string> = {}) =>
  fetch(bridge.mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const TEST_GUIDE = {
  id: "test-guide",
  title: "Test guide",
  description: "A guide for tests",
  content: "# Test guide\n\nBody.",
};

beforeAll(() => {
  agentTools.push(ECHO_TOOL);
  guides.push(TEST_GUIDE);
});
afterAll(() => {
  const guideIndex = guides.indexOf(TEST_GUIDE);
  if (guideIndex >= 0) guides.splice(guideIndex, 1);
  const index = agentTools.indexOf(ECHO_TOOL);
  if (index >= 0) agentTools.splice(index, 1);
});
afterEach(async () => {
  bridges.splice(0).forEach((bridge) => bridge.stop());
});

describe("editor socket security", () => {
  test("rejects upgrades from foreign or missing origins", async () => {
    const bridge = start();
    for (const origin of ["https://evil.example.com", null]) {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/editor`, {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade",
          ...(origin ? { Origin: origin } : {}),
        },
      });
      expect(response.status).toBe(403);
    }
    await expect(connect(bridge, "https://evil.example.com")).rejects.toBeDefined();
  });

  test("honours an explicit origin allowlist", async () => {
    const bridge = start({ allowedOrigins: ["https://pego.app"] });
    await expect(connect(bridge, ORIGIN)).rejects.toBeDefined();
    const editor = await connect(bridge, "https://pego.app");
    editor.ws.close();
  });

  test("rejects a wrong Host header on every route", async () => {
    const bridge = start();
    const wrongHost = { host: "evil.example.com" };
    expect(
      (await fetch(`http://127.0.0.1:${bridge.port}/editor`, { headers: wrongHost })).status,
    ).toBe(403);
    expect(
      (await mcpPost(bridge, { jsonrpc: "2.0", id: 1, method: "tools/list" }, wrongHost)).status,
    ).toBe(403);
  });

  test("rejects browser origins on /mcp but allows origin-less clients", async () => {
    const bridge = start();
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await mcpPost(bridge, body, { origin: "https://evil.example.com" })).status).toBe(403);
    expect((await mcpPost(bridge, body)).status).toBe(200);
  });

  test("unknown paths 404", async () => {
    const bridge = start();
    expect((await fetch(`http://127.0.0.1:${bridge.port}/nope`)).status).toBe(404);
  });

  test("closes the socket on an invalid message", async () => {
    const bridge = start();
    const editor = await connect(bridge);
    editor.ws.send(JSON.stringify({ type: "hello", protocol: "x" }));
    expect((await editor.closed).code).toBe(1008);
  });

  test("closes on protocol mismatch", async () => {
    const bridge = start();
    const editor = await connect(bridge);
    editor.send({ type: "hello", protocol: BRIDGE_PROTOCOL_VERSION + 1, documentName: "d" });
    expect((await editor.closed).code).toBe(4001);
  });

  test("rejects protocol 1 editors and tells the user to reload Pego", async () => {
    const bridge = start();
    const editor = await connect(bridge);
    editor.send({ type: "hello", protocol: 1, documentName: "d" });
    const closed = await editor.closed;
    expect(closed.code).toBe(4001);
    expect(closed.reason).toContain("Reload Pego");
  });

  test("requires hello before other messages", async () => {
    const bridge = start();
    const editor = await connect(bridge);
    editor.send({ type: "run_cancel", runId: "r" });
    expect((await editor.closed).code).toBe(1008);
  });

  test("closes frames over the size cap", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    editor.ws.send("x".repeat(13 * 1024 * 1024));
    expect([1006, 1009]).toContain((await editor.closed).code);
  });
});

describe("protocol and tool forwarding", () => {
  test("welcome carries mcpUrl and claudeCodeAvailable", async () => {
    const bridge = start({}, { claudeCodeAvailable: () => true });
    const { editor, welcome } = await greet(bridge);
    expect(welcome).toEqual({
      type: "welcome",
      protocol: BRIDGE_PROTOCOL_VERSION,
      claudeCodeAvailable: true,
      mcpUrl: bridge.mcpUrl,
    });
    editor.ws.close();
  });

  test("callTool round trip with a fake editor", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    const pending = bridge.hub.callTool("test_echo", { text: "hi" }, { kind: "run", runId: "r1" });
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    expect(call.tool).toBe("test_echo");
    expect(call.input).toEqual({ text: "hi" });
    expect(call.source).toEqual({ kind: "run", runId: "r1" });
    editor.send({ type: "tool_result", callId: call.callId, content: "echo: hi", isError: false });
    expect(await pending).toEqual({ content: "echo: hi", isError: false });
    expect(bridge.hub.pendingCount()).toBe(0);
  });

  test("no editor connected returns an error telling the user to open Pego", async () => {
    const bridge = start();
    const outcome = await bridge.hub.callTool("test_echo", {}, { kind: "mcp" });
    expect(outcome).toEqual({ content: NO_EDITOR_MESSAGE, isError: true });
    expect(NO_EDITOR_MESSAGE).toContain("Open Pego");
  });

  test("times out when the editor never answers", async () => {
    const bridge = start({ toolTimeoutMs: 50 });
    const { editor } = await greet(bridge);
    const outcome = await bridge.hub.callTool("test_echo", {}, { kind: "mcp" });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("did not answer");
    expect(bridge.hub.pendingCount()).toBe(0);
    editor.ws.close();
  });

  test("a newer editor replaces the older one, which is closed with a reason", async () => {
    const bridge = start();
    const first = await greet(bridge, "one");
    const second = await greet(bridge, "two");
    const closed = await first.editor.closed;
    expect(closed.code).toBe(4000);
    expect(closed.reason).toContain("Replaced");
    expect(bridge.hub.getDocumentName()).toBe("two");
    second.editor.ws.close();
  });

  test("pending calls fail when the editor disconnects", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    const pending = bridge.hub.callTool("test_echo", {}, { kind: "mcp" });
    await editor.next("tool_call");
    editor.ws.close();
    const outcome = await pending;
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("disconnected");
  });

  test("a stale socket cannot answer another socket's call", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    const pending = bridge.hub.callTool("test_echo", {}, { kind: "mcp" });
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    const intruder = await connect(bridge);
    intruder.send({ type: "tool_result", callId: call.callId, content: "forged", isError: false });
    expect((await intruder.closed).code).toBe(1008);
    editor.send({ type: "tool_result", callId: call.callId, content: "real", isError: false });
    expect((await pending).content).toBe("real");
  });
});

describe("MCP over HTTP", () => {
  const parseRpc = async (response: Response) => {
    const raw = await response.text();
    const json =
      raw.startsWith("event:") || raw.includes("\ndata:")
        ? raw
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5)
        : raw;
    return JSON.parse(String(json));
  };

  test("initialize, tools/list and tools/call round trip through the editor", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);

    const init = await parseRpc(
      await mcpPost(bridge, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    );
    expect(init.result.serverInfo.name).toBe("pego");

    const list = await parseRpc(
      await mcpPost(bridge, { jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const echo = list.result.tools.find((t: { name: string }) => t.name === "test_echo");
    expect(echo.description).toBe("Echo input");
    expect(echo.inputSchema.type).toBe("object");
    expect(echo.inputSchema.required).toEqual(["text"]);

    const callResponse = mcpPost(
      bridge,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "test_echo", arguments: { text: "hello" } },
      },
      { "user-agent": "claude-code/9.9" },
    );
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    expect(call.input).toEqual({ text: "hello" });
    expect(call.source).toEqual({ kind: "mcp", clientName: "claude-code/9.9" });
    editor.send({
      type: "tool_result",
      callId: call.callId,
      content: "echo: hello",
      isError: false,
    });
    const result = await parseRpc(await callResponse);
    expect(result.result).toEqual({
      content: [{ type: "text", text: "echo: hello" }],
      isError: false,
    });
  });

  test("maps editor isError and no-editor to MCP tool errors; unknown tool errors", async () => {
    const bridge = start();
    const noEditor = await parseRpc(
      await mcpPost(bridge, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test_echo", arguments: { text: "x" } },
      }),
    );
    expect(noEditor.result.isError).toBe(true);
    expect(noEditor.result.content[0].text).toBe(NO_EDITOR_MESSAGE);

    const unknown = await parseRpc(
      await mcpPost(bridge, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "rm_rf", arguments: {} },
      }),
    );
    expect(unknown.result.isError).toBe(true);
  });
});

const PNG = { mediaType: "image/png" as const, data: "iVBORw0KGgo=", width: 2, height: 3 };

describe("MCP surface (images, resources, prompts)", () => {
  const rpc = async (bridge: Bridge, method: string, params?: unknown, id = 1) => {
    const raw = await (await mcpPost(bridge, { jsonrpc: "2.0", id, method, params })).text();
    const line = raw.startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(String(line?.startsWith("data:") ? line.slice(5) : line));
  };

  test("tools/call returns image content before text through the real endpoint", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    const response = rpc(bridge, "tools/call", { name: "test_echo", arguments: { text: "s" } });
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    editor.send({
      type: "tool_result",
      callId: call.callId,
      content: "shot",
      isError: false,
      images: [PNG],
    });
    expect((await response).result.content).toEqual([
      { type: "image", data: PNG.data, mimeType: "image/png" },
      { type: "text", text: "shot" },
    ]);
  });

  test("an invalid image closes the editor socket", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    editor.ws.send(
      JSON.stringify({
        type: "tool_result",
        callId: "c",
        content: "x",
        isError: false,
        images: [{ ...PNG, data: "not base64!!" }],
      }),
    );
    expect((await editor.closed).code).toBe(1008);
  });

  test("resources/list and resources/read serve guides", async () => {
    const bridge = start();
    const list = (await rpc(bridge, "resources/list")).result.resources;
    expect(list).toContainEqual({
      uri: "pego://guides/test-guide",
      name: "test-guide",
      title: "Test guide",
      description: "A guide for tests",
      mimeType: "text/markdown",
    });
    expect(list.some((r: { uri: string }) => r.uri === "pego://document")).toBe(true);
    const read = await rpc(bridge, "resources/read", { uri: "pego://guides/test-guide" });
    expect(read.result.contents).toEqual([
      { uri: "pego://guides/test-guide", mimeType: "text/markdown", text: TEST_GUIDE.content },
    ]);
    const missing = await rpc(bridge, "resources/read", { uri: "pego://guides/nope" });
    expect(missing.error).toBeDefined();
  });

  test("pego://document calls get_document on the editor; no editor gives error text", async () => {
    const bridge = start();
    const none = await rpc(bridge, "resources/read", { uri: "pego://document" });
    expect(none.result.contents[0].text).toContain(NO_EDITOR_MESSAGE);

    const { editor } = await greet(bridge);
    const response = rpc(bridge, "resources/read", { uri: "pego://document" });
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    expect(call.tool).toBe("get_document");
    editor.send({ type: "tool_result", callId: call.callId, content: "DOC", isError: false });
    expect((await response).result.contents[0]).toEqual({
      uri: "pego://document",
      mimeType: "text/plain",
      text: "DOC",
    });
  });

  test("prompts/list and prompts/get", async () => {
    const bridge = start();
    const names = (await rpc(bridge, "prompts/list")).result.prompts.map(
      (p: { name: string }) => p.name,
    );
    expect(names).toEqual(["design_screen", "polish_selection", "extract_components"]);

    const design = await rpc(bridge, "prompts/get", {
      name: "design_screen",
      arguments: { kind: "dashboard", brief: "sales overview" },
    });
    const text = design.result.messages[0].content.text as string;
    expect(design.result.messages[0].role).toBe("user");
    expect(text).toContain("sales overview");
    for (const tool of ["get_guidelines", "batch_design", "get_screenshot", "check_layout"]) {
      expect(text).toContain(tool);
    }
    const polish = await rpc(bridge, "prompts/get", { name: "polish_selection" });
    expect(polish.result.messages[0].content.text).toContain("get_selection");
    const extract = await rpc(bridge, "prompts/get", { name: "extract_components" });
    expect(extract.result.messages[0].content.text).toContain("create_instance");

    expect(
      (
        await rpc(bridge, "prompts/get", {
          name: "design_screen",
          arguments: { kind: "x", brief: "b" },
        })
      ).error,
    ).toBeDefined();
    expect((await rpc(bridge, "prompts/get", { name: "nope" })).error).toBeDefined();
  });
});

describe("Agent SDK in-process server", () => {
  test("tool handler maps editor images to MCP image content", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createPegoMcpServer } = await import("./mcp");
    const server = createPegoMcpServer({
      callTool: async () => ({ content: "shot", isError: false, images: [PNG] }),
      source: () => ({ kind: "run", runId: "r" }),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const result = await client.callTool({ name: "test_echo", arguments: { text: "x" } });
    expect(result.content).toEqual([
      { type: "image", data: PNG.data, mimeType: "image/png" },
      { type: "text", text: "shot" },
    ]);
    await client.close();
  });
});

describe("agent runs", () => {
  test("run_start streams run_events from the injected run manager; run_cancel aborts", async () => {
    const cancelled: string[] = [];
    const bridge = start(
      {},
      {
        runManagerFactory: ({ emit }: { emit: (id: string, e: RunEvent) => void }) => ({
          start: (runId: string, prompt: string) => {
            emit(runId, { kind: "text", text: `got ${prompt}` });
            emit(runId, { kind: "done" });
          },
          cancel: (runId: string) => void cancelled.push(runId),
          cancelAll: () => undefined,
          isRunning: () => false,
        }),
      },
    );
    const { editor } = await greet(bridge);
    editor.send({ type: "run_start", runId: "r1", prompt: "make a card" });
    const first = await editor.next("run_event");
    expect(first).toEqual({
      type: "run_event",
      runId: "r1",
      event: { kind: "text", text: "got make a card" },
    });
    expect((await editor.next("run_event")).type).toBe("run_event");
    editor.send({ type: "run_cancel", runId: "r1" });
    await Bun.sleep(30);
    expect(cancelled).toEqual(["r1"]);
  });
});
