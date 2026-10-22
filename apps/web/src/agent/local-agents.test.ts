/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BridgeToEditor, EditorToBridge, LocalAgentInfo } from "@pego/agent";
import { allRuns } from "./run-registry";
import { AGENT_PREFS_KEY, loadAgentPrefs, parseAgentPrefs, pickDefaultAgent } from "./agent-prefs";
import { createBridgeHandlers } from "./bridge-handlers";
import { startLocalAgentRun } from "./local-agent-run";
import { refreshAgents, requestModels } from "./local-agents";
import { resetStores, visible } from "./test-utils";
import { emptyBridge, useAgentStore } from "./use-agent-store";

const state = () => useAgentStore.getState();

const info = (id: LocalAgentInfo["id"], over: Partial<LocalAgentInfo> = {}): LocalAgentInfo => ({
  id,
  name: id,
  installed: true,
  supportsModels: true,
  steer: "restart",
  ...over,
});

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let storage = memoryStorage();

beforeEach(() => {
  storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  resetStores();
  // Other suites pick a custom provider; start every test without one.
  useAgentStore.setState({
    backend: "api",
    localAgentId: "claude-code",
    customProviderId: null,
    modelByAgent: {},
    modelsByAgent: {},
  });
});

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("agent prefs persistence", () => {
  test("setters persist; restorePrefs brings them back", () => {
    state().setBackend("local");
    state().setLocalAgent("codex");
    state().setModel("codex", " gpt-5 ");
    state().setModel("opencode", "anthropic/claude-sonnet");
    expect(JSON.parse(storage.data.get(AGENT_PREFS_KEY)!)).toEqual({
      backend: "local",
      localAgentId: "codex",
      modelByAgent: { codex: "gpt-5", opencode: "anthropic/claude-sonnet" },
      customProviderId: null,
      explicit: true,
    });

    useAgentStore.setState({ backend: "api", localAgentId: "claude-code", modelByAgent: {} });
    state().restorePrefs();
    expect(state().backend).toBe("local");
    expect(state().localAgentId).toBe("codex");
    expect(state().modelByAgent).toEqual({ codex: "gpt-5", opencode: "anthropic/claude-sonnet" });
  });

  test("clearing a model restores the default", () => {
    state().setModel("codex", "gpt-5");
    state().setModel("codex", undefined);
    state().setModel("qwen", "  ");
    expect(state().modelByAgent).toEqual({});
  });

  test("invalid or missing storage falls back to defaults", () => {
    expect(parseAgentPrefs("{nope")).toEqual(loadAgentPrefs({ getItem: () => null, setItem() {} }));
    expect(
      parseAgentPrefs(
        JSON.stringify({
          backend: "x",
          localAgentId: "bogus",
          modelByAgent: { bogus: "m", codex: 3 },
        }),
      ),
    ).toEqual({
      backend: "local",
      localAgentId: "claude-code",
      modelByAgent: {},
      customProviderId: null,
      explicit: false,
    });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadAgentPrefs(throwing).backend).toBe("local");
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true });
    expect(() => state().setBackend("local")).not.toThrow();
  });
});

describe("default agent", () => {
  test("pickDefaultAgent prefers a ready agent, then any installed one", () => {
    expect(
      pickDefaultAgent([
        info("claude-code", { installed: false }),
        info("codex", { note: "Run codex login" }),
        info("opencode"),
      ]),
    ).toBe("opencode");
    expect(pickDefaultAgent([info("codex", { note: "login" })])).toBe("codex");
    expect(pickDefaultAgent([info("codex", { installed: false })])).toBeNull();
  });

  test("legacy prefs: an untouched api default is not treated as a choice", () => {
    expect(
      parseAgentPrefs(JSON.stringify({ backend: "api", localAgentId: "codex" })),
    ).toMatchObject({
      backend: "local",
      localAgentId: "claude-code",
      explicit: false,
    });
    expect(
      parseAgentPrefs(JSON.stringify({ backend: "local", localAgentId: "codex" })),
    ).toMatchObject({
      backend: "local",
      localAgentId: "codex",
      explicit: true,
    });
  });

  test("welcome selects a ready local agent until the user picks one", async () => {
    const handlers = createBridgeHandlers({ send: () => true });
    const welcome = (agents: LocalAgentInfo[]): BridgeToEditor => ({
      type: "welcome",
      protocol: 3,
      claudeCodeAvailable: false,
      mcpUrl: "http://m",
      projectDir: null,
      agents,
    });
    useAgentStore.setState({ backend: "api", localAgentId: "claude-code", explicit: false });
    await handlers.handleMessage(
      welcome([info("claude-code", { installed: false }), info("opencode")]),
    );
    expect(state()).toMatchObject({ backend: "local", localAgentId: "opencode" });

    state().setBackend("api");
    await handlers.handleMessage(welcome([info("claude-code")]));
    expect(state()).toMatchObject({ backend: "api", explicit: true });
  });
});

describe("protocol v3 handling", () => {
  const setup = () => {
    const sent: EditorToBridge[] = [];
    const handlers = createBridgeHandlers({ send: (m) => (sent.push(m), true) });
    return { handlers, sent };
  };

  test("welcome, agents and models update the store", async () => {
    const { handlers } = setup();
    const welcome: BridgeToEditor = {
      type: "welcome",
      protocol: 3,
      claudeCodeAvailable: true,
      mcpUrl: "http://m",
      projectDir: null,
      agents: [info("claude-code"), info("codex", { installed: false })],
    };
    await handlers.handleMessage(welcome);
    expect(state().bridge.agents.map((a) => a.id)).toEqual(["claude-code", "codex"]);

    useAgentStore.setState({ agentsRefreshing: true });
    await handlers.handleMessage({ type: "agents", agents: [info("codex", { version: "1.0" })] });
    expect(state().bridge.agents).toEqual([info("codex", { version: "1.0" })]);
    expect(state().bridge.connected).toBe(true);
    expect(state().agentsRefreshing).toBe(false);

    await handlers.handleMessage({ type: "models", agentId: "codex", models: ["a", "b"] });
    expect(state().modelsByAgent.codex).toEqual({
      models: ["a", "b"],
      loading: false,
      loaded: true,
    });
    await handlers.handleMessage({
      type: "models",
      agentId: "opencode",
      models: [],
      error: "not logged in",
    });
    expect(state().modelsByAgent.opencode).toMatchObject({ error: "not logged in", loaded: true });

    handlers.handleClosed();
    expect(state().bridge).toEqual(emptyBridge());
    expect(state().modelsByAgent).toEqual({});
  });

  test("requestModels sends once, caches, and retries on force", () => {
    const sent: EditorToBridge[] = [];
    const send = (m: EditorToBridge) => (sent.push(m), true);
    expect(requestModels("codex", false, send)).toBe(true);
    expect(state().modelsByAgent.codex?.loading).toBe(true);
    expect(requestModels("codex", false, send)).toBe(false); // already loading
    useAgentStore.setState({
      modelsByAgent: { codex: { models: ["a"], loading: false, loaded: true } },
    });
    expect(requestModels("codex", false, send)).toBe(false); // cached
    expect(requestModels("codex", true, send)).toBe(true);
    expect(state().modelsByAgent.codex?.models).toEqual(["a"]);
    expect(sent).toEqual([
      { type: "models_request", agentId: "codex" },
      { type: "models_request", agentId: "codex" },
    ]);
    expect(requestModels("codex", true, () => false)).toBe(false);
  });

  test("refreshAgents sends agents_refresh and flags refreshing", () => {
    const sent: EditorToBridge[] = [];
    expect(refreshAgents((m) => (sent.push(m), true))).toBe(true);
    expect(sent).toEqual([{ type: "agents_refresh" }]);
    expect(state().agentsRefreshing).toBe(true);
    useAgentStore.setState({ agentsRefreshing: false });
    expect(refreshAgents(() => false)).toBe(false);
    expect(state().agentsRefreshing).toBe(false);
  });
});

describe("local agent runs", () => {
  const connect = (agents: LocalAgentInfo[]) =>
    useAgentStore.setState({
      bridge: { connected: true, claudeCodeAvailable: true, mcpUrl: "u", agents, projectDir: null },
    });

  test("run_start carries agentId and the selected model", () => {
    connect([info("codex", { name: "Codex" })]);
    state().setLocalAgent("codex");
    state().setModel("codex", "gpt-5");
    const sent: EditorToBridge[] = [];
    startLocalAgentRun("r1", "make a card", (m) => (sent.push(m), true));
    expect(sent).toEqual([
      {
        type: "run_start",
        runId: "r1",
        prompt: expect.stringMatching(/make a card$/),
        agentId: "codex",
        model: "gpt-5",
      },
    ]);
    expect(allRuns()[0]).toMatchObject({ id: "r1", backend: "local" });
    expect(visible().runLabel).toBe("Codex · gpt-5");
    expect(visible().status).toBe("planning");
  });

  test("displayText is what the bubble shows; the agent gets the full prompt", () => {
    connect([info("codex", { name: "Codex" })]);
    state().setLocalAgent("codex");
    const sent: EditorToBridge[] = [];
    startLocalAgentRun(
      "r9",
      "Target layers (a)\n\nmake it red",
      (m) => (sent.push(m), true),
      undefined,
      {
        displayText: "make it red",
      },
    );
    expect(visible().log[0]).toMatchObject({ kind: "user", text: "make it red" });
    expect(visible().prompt).toBe("make it red");
    expect(JSON.stringify(sent)).toContain("Target layers");
  });

  test("no model key when the CLI default is used", () => {
    connect([info("claude-code", { name: "Claude Code" })]);
    const sent: EditorToBridge[] = [];
    startLocalAgentRun("r2", "p", (m) => (sent.push(m), true));
    expect(sent[0]).toEqual({
      type: "run_start",
      runId: "r2",
      prompt: expect.stringMatching(/p$/),
      agentId: "claude-code",
    });
    expect(visible().runLabel).toBe("Claude Code");
  });

  test("not installed agent or missing bridge fails without sending", async () => {
    const sent: EditorToBridge[] = [];
    const send = (m: EditorToBridge) => (sent.push(m), true);
    state().setLocalAgent("gemini");
    connect([info("gemini", { name: "Gemini CLI", installed: false })]);
    startLocalAgentRun("r3", "p", send);
    expect(visible().status).toBe("failed");
    expect(visible().log.at(-1)?.text).toContain("not installed");

    useAgentStore.setState({ bridge: emptyBridge() });
    await startLocalAgentRun("r4", "p", send, undefined, { bridgeWaitMs: 0 });
    expect(visible().log.at(-1)?.text).toContain("bridge is not running");
    expect(sent).toEqual([]);
    expect(allRuns()).toEqual([]);
  });

  test("failed send clears the active run", async () => {
    connect([info("claude-code")]);
    await startLocalAgentRun("r5", "p", () => false, undefined, { bridgeWaitMs: 0 });
    expect(allRuns()).toEqual([]);
    expect(visible().status).toBe("failed");
  });
});
