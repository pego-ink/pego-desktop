import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  agentTools,
  BRIDGE_PROTOCOL_VERSION,
  skills,
  skillToMarkdown,
  type BridgeToEditor,
  type EditorToBridge,
  type RunEvent,
} from "@pego/agent";
import { makeAttachment } from "./agents/fixtures/images";
import { MAX_WS_MESSAGE_BYTES, type BridgeConfig } from "./config";
import type { AgentAdapter } from "./agents/types";
import { MAX_EDITOR_SOCKETS, NO_EDITOR_MESSAGE } from "./editor-hub";
import type { RunRequest } from "./runs";
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

const fakeAdapter = (id: AgentAdapter["id"], installed = true): AgentAdapter => ({
  id,
  name: id,
  supportsModels: true,
  detect: async () =>
    installed ? { installed: true, version: "1.0.0" } : { installed: false, note: "not installed" },
  run: async (ctx) => ctx.emit({ kind: "done" }),
});

const bridges: Bridge[] = [];
const start = (overrides: Partial<BridgeConfig> = {}, extra: Record<string, unknown> = {}) => {
  // No real agent CLIs unless a test opts in: detection would spawn them on every welcome.
  const bridge = startBridge({ ...baseConfig(overrides), adapters: [], ...extra });
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

const TEST_SKILL = {
  id: "test-skill",
  title: "Test skill",
  description: "A skill for tests",
  keywords: ["test"],
  content: "Body.",
  checklist: ["Check one"],
  styles: [],
};

const TEST_STYLE = {
  id: "test-style",
  title: "Test style",
  description: "A style for tests",
  keywords: [],
  content: "Style body.",
  checklist: [],
  styles: [],
  category: "style" as const,
};

beforeAll(() => {
  agentTools.push(ECHO_TOOL);
  skills.push(TEST_SKILL, TEST_STYLE);
});
afterAll(() => {
  const styleIndex = skills.indexOf(TEST_STYLE);
  if (styleIndex >= 0) skills.splice(styleIndex, 1);
  const skillIndex = skills.indexOf(TEST_SKILL);
  if (skillIndex >= 0) skills.splice(skillIndex, 1);
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
    editor.ws.send("x".repeat(MAX_WS_MESSAGE_BYTES + 1024));
    expect([1006, 1009]).toContain((await editor.closed).code);
  });
});

describe("protocol and tool forwarding", () => {
  test("welcome carries mcpUrl, detected agents and claudeCodeAvailable", async () => {
    const bridge = start(
      {},
      { adapters: [fakeAdapter("claude-code"), fakeAdapter("codex", false)] },
    );
    const { editor, welcome } = await greet(bridge);
    expect(welcome).toEqual({
      type: "welcome",
      protocol: BRIDGE_PROTOCOL_VERSION,
      claudeCodeAvailable: true,
      mcpUrl: bridge.mcpUrl,
      agents: [
        {
          id: "claude-code",
          name: "claude-code",
          supportsModels: true,
          steer: "restart",
          installed: true,
          version: "1.0.0",
        },
        {
          id: "codex",
          name: "codex",
          supportsModels: true,
          steer: "restart",
          installed: false,
          note: "not installed",
        },
      ],
    });
    editor.ws.close();
  });

  test("claudeCodeAvailable is false when claude-code is missing", async () => {
    const bridge = start({}, { adapters: [fakeAdapter("claude-code", false)] });
    const { editor, welcome } = await greet(bridge);
    expect((welcome as { claudeCodeAvailable: boolean }).claudeCodeAvailable).toBe(false);
    editor.ws.close();
  });

  test("agents_refresh re-detects and answers with agents; models_request answers with models", async () => {
    let installed = false;
    const adapter: AgentAdapter = {
      ...fakeAdapter("codex"),
      detect: async () => ({ installed }),
      listModels: async () => ["m1", "provider/m2(high)"],
    };
    const bridge = start({}, { adapters: [adapter] });
    const { editor } = await greet(bridge);
    installed = true;
    editor.send({ type: "agents_refresh" });
    const agents = (await editor.next("agents")) as Extract<BridgeToEditor, { type: "agents" }>;
    expect(agents.agents[0]?.installed).toBe(true);
    editor.send({ type: "models_request", agentId: "codex" });
    expect(await editor.next("models")).toEqual({
      type: "models",
      agentId: "codex",
      models: ["m1", "provider/m2(high)"],
    });
    editor.ws.close();
  });

  test("models_request reports an error string when listing fails", async () => {
    const adapter: AgentAdapter = {
      ...fakeAdapter("opencode"),
      listModels: async () => {
        throw new Error("boom");
      },
    };
    const bridge = start({}, { adapters: [adapter] });
    const { editor } = await greet(bridge);
    editor.send({ type: "models_request", agentId: "opencode" });
    expect(await editor.next("models")).toEqual({
      type: "models",
      agentId: "opencode",
      models: [],
      error: "boom",
    });
    editor.ws.close();
  });

  test("callTool round trip with a fake editor", async () => {
    const bridge = start();
    const { editor } = await greet(bridge);
    const pending = bridge.hub.callTool("test_echo", { text: "hi" }, { kind: "mcp" });
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    expect(call.tool).toBe("test_echo");
    expect(call.input).toEqual({ text: "hi" });
    expect(call.source).toEqual({ kind: "mcp" });
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

  test("several editors stay connected at once", async () => {
    const bridge = start();
    const first = await greet(bridge, "one");
    const second = await greet(bridge, "two");
    await Bun.sleep(30);
    expect(first.editor.ws.readyState).toBe(WebSocket.OPEN);
    expect(second.editor.ws.readyState).toBe(WebSocket.OPEN);
    expect(bridge.hub.editorCount()).toBe(2);
    expect(bridge.hub.getDocumentName()).toBe("two");
    first.editor.ws.close();
    second.editor.ws.close();
  });

  /** Fire an MCP-source call and report which editors received the tool_call. */
  const mcpCallTarget = async (bridge: Bridge, editors: Record<string, FakeEditor>) => {
    const pending = bridge.hub.callTool("test_echo", {}, { kind: "mcp" });
    await Bun.sleep(30);
    const hits = Object.entries(editors).filter(([, e]) =>
      e.inbox.some((m) => m.type === "tool_call"),
    );
    expect(hits).toHaveLength(1);
    const [name, editor] = hits[0] as [string, FakeEditor];
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    editor.send({ type: "tool_result", callId: call.callId, content: "ok", isError: false });
    expect((await pending).isError).toBe(false);
    return name;
  };

  test("MCP calls go to the most recent editor; focus switches the target; disconnect falls back", async () => {
    const bridge = start();
    const a = (await greet(bridge, "a")).editor;
    const b = (await greet(bridge, "b")).editor;
    const c = (await greet(bridge, "c")).editor;
    const all = { a, b, c };
    expect(await mcpCallTarget(bridge, all)).toBe("c");
    a.send({ type: "focus" });
    await Bun.sleep(30);
    expect(await mcpCallTarget(bridge, all)).toBe("a");
    b.send({ type: "focus" });
    await Bun.sleep(30);
    expect(await mcpCallTarget(bridge, all)).toBe("b");
    b.ws.close();
    await b.closed;
    await Bun.sleep(30);
    // a was active before b, so a takes over; then c once a is gone too.
    expect(await mcpCallTarget(bridge, { a, c })).toBe("a");
    a.ws.close();
    await a.closed;
    await Bun.sleep(30);
    expect(await mcpCallTarget(bridge, { c })).toBe("c");
    c.ws.close();
  });

  test("the pego://document resource is read from the active editor", async () => {
    const bridge = start();
    const a = (await greet(bridge, "a")).editor;
    const b = (await greet(bridge, "b")).editor;
    a.send({ type: "focus" });
    await Bun.sleep(30);
    const pending = bridge.hub.callTool("get_document", {}, { kind: "mcp" });
    const call = (await a.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    expect(b.inbox.some((m) => m.type === "tool_call")).toBe(false);
    a.send({ type: "tool_result", callId: call.callId, content: "x", isError: false });
    await pending;
    a.ws.close();
    b.ws.close();
  });

  test("a socket that never sent hello cannot focus or do anything", async () => {
    const bridge = start();
    const editor = await connect(bridge);
    editor.send({ type: "focus" });
    expect((await editor.closed).code).toBe(1008);
    expect(bridge.hub.editorCount()).toBe(0);
  });

  test("caps concurrent editor sockets", async () => {
    const bridge = start();
    const editors: FakeEditor[] = [];
    for (let i = 0; i < MAX_EDITOR_SOCKETS; i++)
      editors.push((await greet(bridge, `e${i}`)).editor);
    expect(bridge.hub.editorCount()).toBe(MAX_EDITOR_SOCKETS);
    const rejected = await fetch(`http://127.0.0.1:${bridge.port}/editor`, {
      headers: { Origin: ORIGIN, Upgrade: "websocket", Connection: "Upgrade" },
    });
    expect(rejected.status).toBe(503);
    expect(bridge.hub.editorCount()).toBe(MAX_EDITOR_SOCKETS);
    editors.forEach((e) => e.ws.close());
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

  test("resources/list and resources/read serve skills", async () => {
    const bridge = start();
    const list = (await rpc(bridge, "resources/list")).result.resources;
    expect(list).toContainEqual({
      uri: "pego://skills/test-skill",
      name: "test-skill",
      title: "Test skill",
      description: "A skill for tests [design]",
      mimeType: "text/markdown",
    });
    expect(list).toContainEqual({
      uri: "pego://skills/test-style",
      name: "test-style",
      title: "Test style",
      description: "A style for tests [style]",
      mimeType: "text/markdown",
    });
    expect(list.some((r: { uri: string }) => r.uri === "pego://document")).toBe(true);
    const read = await rpc(bridge, "resources/read", { uri: "pego://skills/test-skill" });
    const [content] = read.result.contents;
    expect(content).toEqual({
      uri: "pego://skills/test-skill",
      mimeType: "text/markdown",
      text: skillToMarkdown(TEST_SKILL),
    });
    expect(content.text).toContain("- Check one");
    const missing = await rpc(bridge, "resources/read", { uri: "pego://skills/nope" });
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
    for (const tool of ["get_skill", "batch_design", "get_screenshot", "check_layout"]) {
      expect(text).toContain(tool);
    }
    expect(text).not.toContain("Style:");

    const styled = await rpc(bridge, "prompts/get", {
      name: "design_screen",
      arguments: { kind: "landing-page", brief: "coffee shop", style: "test-style" },
    });
    const styledText = styled.result.messages[0].content.text as string;
    expect(styledText).toContain("Style: test-style");
    expect(styledText).toContain('get_skill for "test-style"');
    for (const style of ["test-skill", "nope"]) {
      expect(
        (
          await rpc(bridge, "prompts/get", {
            name: "design_screen",
            arguments: { kind: "landing-page", brief: "b", style },
          })
        ).error,
      ).toBeDefined();
    }
    const listed = (await rpc(bridge, "prompts/list")).result.prompts.find(
      (p: { name: string }) => p.name === "design_screen",
    );
    expect(listed.arguments.map((a: { name: string }) => a.name)).toEqual([
      "kind",
      "brief",
      "style",
    ]);

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
          start: ({ runId, prompt }: RunRequest) => {
            emit(runId, { kind: "text", text: `got ${prompt}` });
            emit(runId, { kind: "text", text: "more" });
          },
          resolveRunToken: () => undefined,
          cancel: (runId: string) => void cancelled.push(runId),
          cancelAll: () => undefined,
          isRunning: () => false,
        }),
      },
    );
    const { editor } = await greet(bridge);
    editor.send({ type: "run_start", runId: "r1", prompt: "make a card", agentId: "codex" });
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

  test("run_start forwards validated attachments (sanitized names) to the run manager", async () => {
    const seen: RunRequest[] = [];
    const bridge = start(
      {},
      {
        runManagerFactory: () => ({
          start: (request: RunRequest) => void seen.push(request),
          resolveRunToken: () => undefined,
          cancel: () => undefined,
          cancelAll: () => undefined,
          isRunning: () => false,
        }),
      },
    );
    const { editor } = await greet(bridge);
    const attachment = makeAttachment("att-1", "image/png", { name: "../x/shot.png" });
    editor.send({
      type: "run_start",
      runId: "r1",
      prompt: "look",
      agentId: "claude-code",
      attachments: [attachment],
    });
    await Bun.sleep(50);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.attachments).toEqual([{ ...attachment, name: "shot.png" }]);
  });

  test("a frame with the maximum attachments (6 x 5 MB) is accepted", async () => {
    const seen: RunRequest[] = [];
    const bridge = start(
      {},
      {
        runManagerFactory: () => ({
          start: (request: RunRequest) => void seen.push(request),
          resolveRunToken: () => undefined,
          cancel: () => undefined,
          cancelAll: () => undefined,
          isRunning: () => false,
        }),
      },
    );
    const { editor } = await greet(bridge);
    const big = makeAttachment("att-1", "image/png");
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(5 * 1024 * 1024 - 8),
    ]).toString("base64");
    const attachments = Array.from({ length: 6 }, (_, index) => ({
      ...big,
      id: `att-${index + 1}`,
      data: png,
    }));
    editor.send({
      type: "run_start",
      runId: "r1",
      prompt: "x".repeat(100_000),
      agentId: "claude-code",
      attachments,
    });
    await Bun.sleep(1500);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.attachments).toHaveLength(6);
  });

  test("an invalid attachment closes nothing but never reaches the run manager", async () => {
    const seen: RunRequest[] = [];
    const bridge = start(
      {},
      {
        runManagerFactory: () => ({
          start: (request: RunRequest) => void seen.push(request),
          resolveRunToken: () => undefined,
          cancel: () => undefined,
          cancelAll: () => undefined,
          isRunning: () => false,
        }),
      },
    );
    const { editor } = await greet(bridge);
    editor.send({
      type: "run_start",
      runId: "r1",
      prompt: "x",
      agentId: "claude-code",
      attachments: [makeAttachment("att-1", "image/png", { mediaType: "image/svg+xml" as never })],
    });
    await Bun.sleep(100);
    expect(seen).toEqual([]);
  });
});

describe("run ownership across editors", () => {
  const setup = () => {
    const cancelled: string[] = [];
    const ctl: {
      emit: (id: string, e: RunEvent) => void;
      callTool: Bridge["hub"]["callTool"];
    } = { emit: () => undefined, callTool: async () => ({ content: "", isError: true }) };
    const bridge = start(
      {},
      {
        runManagerFactory: (deps: typeof ctl) => {
          ctl.emit = deps.emit;
          ctl.callTool = deps.callTool;
          return {
            start: () => undefined,
            resolveRunToken: () => undefined,
            cancel: (runId: string) => void cancelled.push(runId),
            cancelAll: () => undefined,
            isRunning: () => false,
          };
        },
      },
    );
    return { bridge, ctl, cancelled };
  };

  test("run tool calls and run_events go only to the owner, even when another editor is active", async () => {
    const { bridge, ctl } = setup();
    const owner = (await greet(bridge, "owner")).editor;
    const other = (await greet(bridge, "other")).editor; // active now
    owner.send({ type: "run_start", runId: "r1", prompt: "go", agentId: "codex" });
    await Bun.sleep(30);

    const pending = ctl.callTool("test_echo", {}, { kind: "run", runId: "r1" });
    const call = (await owner.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    owner.send({ type: "tool_result", callId: call.callId, content: "ok", isError: false });
    expect((await pending).isError).toBe(false);

    ctl.emit("r1", { kind: "text", text: "hi" });
    await owner.next("run_event");
    await Bun.sleep(30);
    expect(other.inbox.some((m) => m.type === "tool_call" || m.type === "run_event")).toBe(false);

    // The run ended: the owner is forgotten, so late calls fail instead of going elsewhere.
    ctl.emit("r1", { kind: "done" });
    await owner.next("run_event");
    expect((await ctl.callTool("test_echo", {}, { kind: "run", runId: "r1" })).content).toBe(
      NO_EDITOR_MESSAGE,
    );
    expect(other.inbox.some((m) => m.type === "tool_call")).toBe(false);
    owner.ws.close();
    other.ws.close();
  });

  test("owner disconnect cancels only its run; another editor's run is untouched", async () => {
    const { bridge, cancelled } = setup();
    const a = (await greet(bridge, "a")).editor;
    const b = (await greet(bridge, "b")).editor;
    a.send({ type: "run_start", runId: "ra", prompt: "go", agentId: "codex" });
    b.send({ type: "run_start", runId: "rb", prompt: "go", agentId: "codex" });
    await Bun.sleep(30);
    b.ws.close();
    await b.closed;
    await Bun.sleep(30);
    expect(cancelled).toEqual(["rb"]);
    // A non-owner cannot cancel someone else's run.
    const c = (await greet(bridge, "c")).editor;
    c.send({ type: "run_cancel", runId: "ra" });
    await Bun.sleep(30);
    expect(cancelled).toEqual(["rb"]);
    a.ws.close();
    c.ws.close();
  });
});

describe("run-scoped MCP endpoint", () => {
  const rpc = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const callGetDocument = (url: string, headers: Record<string, string> = {}) =>
    rpc(
      url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_document", arguments: {} },
      },
      headers,
    );

  test("tool calls through the token URL reach the editor with source run; the URL dies with the run", async () => {
    const urls: string[] = [];
    let finishRun: () => void = () => undefined;
    const adapter: AgentAdapter = {
      ...fakeAdapter("codex"),
      run: async (ctx) => {
        urls.push(ctx.mcpUrl);
        await new Promise<void>((resolve) => (finishRun = resolve));
        ctx.emit({ kind: "done" });
      },
    };
    const bridge = start({}, { adapters: [adapter] });
    const { editor } = await greet(bridge);
    editor.send({ type: "run_start", runId: "run-9", prompt: "go", agentId: "codex" });
    while (urls.length === 0) await Bun.sleep(5);
    const url = urls[0] as string;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/run\/[A-Za-z0-9_-]{43}$/);

    const pending = callGetDocument(url);
    const call = (await editor.next("tool_call")) as Extract<BridgeToEditor, { type: "tool_call" }>;
    expect(call.tool).toBe("get_document");
    expect(call.source).toEqual({ kind: "run", runId: "run-9" });
    editor.send({ type: "tool_result", callId: call.callId, content: "doc", isError: false });
    expect((await pending).status).toBe(200);

    // Same protections as /mcp: foreign Host and browser origins are refused.
    expect((await callGetDocument(url, { host: "evil.example.com" })).status).toBe(403);
    expect((await callGetDocument(url, { origin: "https://evil.example.com" })).status).toBe(403);
    // A wrong token of the right shape is just a 404.
    expect((await callGetDocument(url.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).status).toBe(
      404,
    );

    finishRun();
    await editor.next("run_event");
    while (bridge.runs.isRunning()) await Bun.sleep(5);
    expect((await callGetDocument(url)).status).toBe(404);
    editor.ws.close();
  });

  test("malformed run tokens are 404", async () => {
    const bridge = start();
    for (const path of ["/mcp/run/", "/mcp/run/short", "/mcp/run/../mcp", "/mcp/runx"]) {
      const response = await rpc(`http://127.0.0.1:${bridge.port}${path}`, {});
      expect(response.status).toBe(404);
    }
  });
});
