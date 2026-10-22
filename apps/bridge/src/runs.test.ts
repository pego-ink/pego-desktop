import { describe, expect, test } from "bun:test";
import { agentTools, type RunEvent } from "@pego/agent";
import { createPegoMcpServer } from "@/mcp";
import { buildQueryOptions, createRunManager } from "@/runs";

const fakeStream = (messages: unknown[], hold?: Promise<void>) =>
  (async function* () {
    for (const message of messages) {
      await hold;
      yield message;
    }
  })();

describe("buildQueryOptions", () => {
  test("restricts the run to Pego's MCP tools with no side effects", () => {
    const mcpServer = createPegoMcpServer({
      callTool: async () => ({ content: "", isError: false }),
      source: () => ({ kind: "run", runId: "r" }),
    });
    const options = buildQueryOptions({
      cwd: "/tmp/x",
      abortController: new AbortController(),
      mcpServer,
    });
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(agentTools.map((t) => `mcp__pego__${t.name}`));
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.settingSources).toEqual([]);
    expect(options.persistSession).toBe(false);
    expect(options.strictMcpConfig).toBe(true);
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["pego"]);
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("createRunManager", () => {
  const collect = () => {
    const events: Array<[string, RunEvent]> = [];
    return { events, emit: (runId: string, event: RunEvent) => void events.push([runId, event]) };
  };

  test("maps a recorded SDK stream to events and finishes with done", async () => {
    const { events, emit } = collect();
    const runs = createRunManager({
      callTool: async () => ({ content: "", isError: false }),
      emit,
      runQuery: (() =>
        fakeStream([
          {
            type: "assistant",
            parent_tool_use_id: null,
            message: { content: [{ type: "text", text: "hi" }] },
          },
          {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "ok",
            total_cost_usd: 0.01,
            usage: { input_tokens: 3, output_tokens: 4 },
          },
        ])) as never,
    });
    runs.start("r1", "go");
    while (runs.isRunning()) await Bun.sleep(5);
    expect(events.map(([, e]) => e.kind)).toEqual(["text", "usage", "done"]);
  });

  test("rejects a second concurrent run and supports cancel", async () => {
    const { events, emit } = collect();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const runs = createRunManager({
      callTool: async () => ({ content: "", isError: false }),
      emit,
      runQuery: ((params: { options?: { abortController?: AbortController } }) =>
        (async function* () {
          await hold;
          if (params.options?.abortController?.signal.aborted) throw new Error("aborted");
          yield { type: "system" };
        })()) as never,
    });
    runs.start("a", "one");
    runs.start("b", "two");
    expect(events).toEqual([
      ["b", { kind: "error", message: "Another run is already in progress." }],
    ]);
    runs.cancel("a");
    release();
    while (runs.isRunning()) await Bun.sleep(5);
    expect(events.at(-1)).toEqual(["a", { kind: "error", message: "Run cancelled." }]);
  });

  test("a thrown auth failure becomes a single error event", async () => {
    const { events, emit } = collect();
    const runs = createRunManager({
      callTool: async () => ({ content: "", isError: false }),
      emit,
      runQuery: (() => {
        throw new Error("Invalid API key · Please run /login");
      }) as never,
    });
    runs.start("r", "go");
    while (runs.isRunning()) await Bun.sleep(5);
    expect(events).toHaveLength(1);
    expect(events[0]?.[1]).toMatchObject({ kind: "error" });
    expect((events[0]?.[1] as { message: string }).message).toContain("log in");
  });
});
