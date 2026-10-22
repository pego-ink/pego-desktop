import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { agentTools, type RunEvent } from "@pego/agent";
import { createPegoMcpServer } from "../mcp";
import {
  buildQueryOptions,
  CLAUDE_MODELS,
  claudeCodeAdapter,
  createClaudeCodeAdapter,
} from "./claude-code";
import type { AgentRunContext } from "./types";

const mcpServer = () =>
  createPegoMcpServer({
    callTool: async () => ({ content: "", isError: false }),
    source: () => ({ kind: "run", runId: "r" }),
  });

describe("buildQueryOptions", () => {
  const base = {
    cwd: "/tmp/x",
    abortController: new AbortController(),
    mcpServer: mcpServer(),
    systemPrompt: "SYS",
    env: { PATH: "/bin" },
  };

  test("restricts the run to Pego's MCP tools with no side effects", () => {
    const options = buildQueryOptions(base);
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(agentTools.map((t) => `mcp__pego__${t.name}`));
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.settingSources).toEqual([]);
    expect(options.persistSession).toBe(false);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.systemPrompt).toBe("SYS");
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["pego"]);
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env?.PATH).toBe("/bin");
  });

  test("model: passed through unless it is the default marker", () => {
    expect(buildQueryOptions(base).model).toBeUndefined();
    expect(buildQueryOptions({ ...base, model: "default" }).model).toBeUndefined();
    expect(buildQueryOptions({ ...base, model: "claude-opus-5-5" }).model).toBe("claude-opus-5-5");
  });
});

const fakeStream = (messages: unknown[]) =>
  (async function* () {
    for (const message of messages) yield message;
  })();

const makeCtx = (overrides: Partial<AgentRunContext> = {}) => {
  const events: RunEvent[] = [];
  const ctx: AgentRunContext = {
    runId: "r",
    prompt: "go",
    mcpUrl: "http://127.0.0.1:1/mcp/run/x",
    systemPrompt: "SYS",
    workdir: "/tmp",
    env: { PATH: "/bin" },
    createMcpServer: mcpServer,
    signal: new AbortController().signal,
    emit: (event) => void events.push(event),
    ...overrides,
  };
  return { ctx, events };
};

describe("claude-code adapter", () => {
  test("lists the default plus the Opus and Sonnet ids", async () => {
    expect(claudeCodeAdapter.supportsModels).toBe(true);
    expect(await claudeCodeAdapter.listModels?.({})).toEqual(CLAUDE_MODELS);
    expect(CLAUDE_MODELS).toEqual(["default", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  test("maps a recorded SDK stream to events and finishes with done", async () => {
    let seenModel: string | undefined;
    const adapter = createClaudeCodeAdapter({
      runQuery: ((params: { options?: { model?: string } }) => {
        seenModel = params.options?.model;
        return fakeStream([
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
        ]);
      }) as never,
    });
    const { ctx, events } = makeCtx({ model: "claude-sonnet-5-5" });
    await adapter.run(ctx);
    expect(events.map((e) => e.kind)).toEqual(["text", "usage", "done"]);
    expect(seenModel).toBe("claude-sonnet-5-5");
  });

  test("a thrown auth failure becomes a login hint error", async () => {
    const adapter = createClaudeCodeAdapter({
      runQuery: (() => {
        throw new Error("Invalid API key · Please run /login");
      }) as never,
    });
    const { ctx, events } = makeCtx();
    await adapter.run(ctx);
    expect(events).toHaveLength(1);
    expect((events[0] as { message: string }).message).toContain("log in");
  });

  test("aborting the run aborts the SDK query", async () => {
    let queryAbort: AbortController | undefined;
    const adapter = createClaudeCodeAdapter({
      runQuery: ((params: { options?: { abortController?: AbortController } }) => {
        queryAbort = params.options?.abortController;
        // eslint-disable-next-line require-yield
        return (async function* () {
          await new Promise<void>((resolve) =>
            queryAbort?.signal.addEventListener("abort", () => resolve()),
          );
          throw new Error("aborted");
        })();
      }) as never,
    });
    const abort = new AbortController();
    const { ctx, events } = makeCtx({ signal: abort.signal });
    const running = adapter.run(ctx);
    await Bun.sleep(20);
    abort.abort();
    await running;
    expect(queryAbort?.signal.aborted).toBe(true);
    expect(events).toEqual([{ kind: "error", message: "Run cancelled." }]);
  });

  test("the in-process server is bound to the run (tools list is Pego's)", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([mcpServer().connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(agentTools.map((t) => t.name));
    await client.close();
  });

  test("without the in-process server factory it fails loudly", async () => {
    const { ctx, events } = makeCtx({ createMcpServer: undefined });
    await claudeCodeAdapter.run(ctx);
    expect(events[0]).toMatchObject({ kind: "error" });
  });

  test("declares native steer", () => {
    expect(claudeCodeAdapter.steer).toBe("native");
  });

  const result = { type: "result", subtype: "success", is_error: false, result: "ok", usage: {} };

  /** A fake SDK: drains the prompt iterable, answering each user message with one result. */
  const echoQuery = (seen: string[], onMessage?: (index: number) => Promise<void>) =>
    ((params: { prompt: AsyncIterable<{ message: { content: unknown } }> }) =>
      (async function* () {
        let index = 0;
        for await (const message of params.prompt) {
          seen.push(
            typeof message.message.content === "string" ? message.message.content : "[blocks]",
          );
          await onMessage?.(index++);
          yield result;
        }
      })()) as never;

  test("the first prompt streams in, and the run ends after its result when nothing is steered", async () => {
    const seen: string[] = [];
    const adapter = createClaudeCodeAdapter({ runQuery: echoQuery(seen) });
    const { ctx, events } = makeCtx();
    await adapter.run(ctx);
    expect(seen).toEqual(["go"]);
    expect(events.map((e) => e.kind)).toEqual(["usage", "done"]);
  });

  test("a steer message is yielded after the first prompt; done only after the last result", async () => {
    const seen: string[] = [];
    let steer: ((s: { text: string }) => boolean) | undefined;
    const adapter = createClaudeCodeAdapter({
      runQuery: echoQuery(seen, async (index) => {
        // While the first turn is "running", the user steers.
        if (index === 0) expect(steer?.({ text: "turn left" })).toBe(true);
      }),
    });
    const { ctx, events } = makeCtx({
      onSteer: (handler) => {
        steer = handler;
      },
    });
    await adapter.run(ctx);
    expect(seen).toEqual(["go", "turn left"]);
    // Two results, but a single terminal done (the first result is not the end of the run).
    expect(events.map((e) => e.kind)).toEqual(["usage", "usage", "done"]);
  });

  test("a steer after the run ended is refused", async () => {
    let steer: ((s: { text: string }) => boolean) | undefined;
    const adapter = createClaudeCodeAdapter({ runQuery: echoQuery([]) });
    const { ctx } = makeCtx({
      onSteer: (handler) => {
        steer = handler;
      },
    });
    await adapter.run(ctx);
    expect(steer?.({ text: "too late" })).toBe(false);
  });

  test("an error result ends the run without waiting for steer messages", async () => {
    const adapter = createClaudeCodeAdapter({
      runQuery: ((params: { prompt: AsyncIterable<unknown> }) =>
        (async function* () {
          for await (const message of params.prompt) {
            void message;
            yield {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              errors: ["boom"],
            };
          }
        })()) as never,
    });
    const { ctx, events } = makeCtx();
    await adapter.run(ctx);
    expect(events.at(-1)).toEqual({ kind: "error", message: "boom" });
  });
});
