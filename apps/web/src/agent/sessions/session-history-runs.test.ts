/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EditorToBridge } from "@pego/agent";
import { runApiAgent, type MessagesClient } from "@/agent/api-runtime";
import { startCustomRun, type CustomRunDeps } from "@/agent/run";
import { startLocalAgentRun } from "@/agent/local-agent-run";
import { runOpenAiCompatibleAgent } from "@/agent/providers/openai-runtime";
import { resetStores } from "@/agent/test-utils";
import { createToolHost } from "@/agent/tool-host";
import { useAgentStore } from "@/agent/use-agent-store";
import { buildHistoryBlock } from "./session-context";
import type { SessionTurn } from "./session-model";

const HISTORY = buildHistoryBlock([
  {
    runId: "old",
    status: "done",
    runLabel: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    log: [
      { id: "1", at: 0, kind: "user", text: "make a pricing card" },
      { id: "2", at: 0, kind: "assistant", text: "Built the pricing card." },
    ],
  } satisfies SessionTurn,
]);
const PROMPT = "make it dark";

beforeEach(() => {
  resetStores();
  useAgentStore.getState().set({ status: "planning" });
});

const state = () => useAgentStore.getState();

describe("session memory reaches every backend", () => {
  test("local: run_start prompt carries the history, the bubble only the typed text", async () => {
    state().set({
      bridge: { connected: true, claudeCodeAvailable: true, mcpUrl: "u", agents: [] },
    });
    const sent: EditorToBridge[] = [];
    await startLocalAgentRun("r1", PROMPT, (m) => (sent.push(m), true), null, { history: HISTORY });
    const start = sent[0];
    if (start?.type !== "run_start") throw new Error("expected run_start");
    expect(start.prompt).toContain(HISTORY);
    expect(start.prompt).toEndWith(`Current request:\n${PROMPT}`);
    expect(state().log[0]).toMatchObject({ kind: "user", text: PROMPT });
  });

  test("custom: both dialects receive the history; the prompt stays the user's", async () => {
    const seen: { prompt: string; history: unknown }[] = [];
    const record = async (prompt: string, ctx: { history?: string }) => {
      seen.push({ prompt, history: ctx.history });
    };
    for (const kind of ["openai-compatible", "anthropic-compatible"] as const) {
      const deps = {
        listProviders: async () => [
          {
            id: "p1",
            name: "G",
            kind,
            baseUrl: "https://x.test/v1",
            models: [],
            executorModel: "m",
            createdAt: 1,
          },
        ],
        loadKey: async () => "k",
        runOpenAi: record,
        runAnthropic: record,
      } as unknown as CustomRunDeps;
      state().setCustomProvider("p1");
      await startCustomRun("r", PROMPT, null, deps, [], HISTORY);
    }
    expect(seen).toEqual([
      { prompt: PROMPT, history: HISTORY },
      { prompt: PROMPT, history: HISTORY },
    ]);
  });

  test("api: planner and step turns contain the history, skills follow the typed prompt", async () => {
    const bodies: string[] = [];
    const reply = (text: string) => ({
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_details: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const replies = [
      reply(JSON.stringify({ steps: [{ id: "s1", title: "Do", detail: "it" }] })),
      reply("Done."),
    ];
    const client = {
      beta: {
        messages: {
          stream: (body: unknown) => {
            bodies.push(JSON.stringify(body));
            return { finalMessage: async () => replies.shift() };
          },
        },
      },
    } as unknown as MessagesClient;
    await runApiAgent(PROMPT, {
      client,
      host: createToolHost(),
      signal: new AbortController().signal,
      skillId: null,
      history: HISTORY,
    });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toContain("Earlier in this session");
      expect(body).toContain("Current request:");
      expect(body).toContain("Built the pricing card.");
    }
  });

  describe("openai-compatible", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    test("planner and step turns contain the history", async () => {
      const bodies: string[] = [];
      const completion = (content: string) =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
      const replies = [
        completion(JSON.stringify({ steps: [{ id: "s1", title: "Do", detail: "it" }] })),
        completion("Done."),
      ];
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        bodies.push(init.body as string);
        return replies.shift();
      }) as unknown as typeof fetch;
      await runOpenAiCompatibleAgent(PROMPT, {
        provider: {
          id: "p",
          name: "T",
          kind: "openai-compatible",
          baseUrl: "https://llm.test/v1",
          models: [],
          executorModel: "m",
          createdAt: 1,
        },
        apiKey: "k",
        host: createToolHost(),
        signal: new AbortController().signal,
        skillId: null,
        history: HISTORY,
      });
      expect(bodies).toHaveLength(2);
      for (const body of bodies) expect(body).toContain("Built the pricing card.");
    });
  });
});

describe("transcript store", () => {
  test("beginRun moves the previous run into the session instead of discarding it", () => {
    state().appendLog({ kind: "user", text: "first" });
    state().appendLog({ kind: "assistant", text: "one" });
    state().set({ status: "done" });
    state().beginRun("run-2", "second");
    expect(state().log).toEqual([]);
    expect(state().turns).toHaveLength(1);
    expect(state().turns[0]?.log.map((e) => e.text)).toEqual(["first", "one"]);
    expect(state().turns[0]?.runId).toBe("run-test");
  });
});
