/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { toolByName } from "@pego/agent";
import { resetStores, visible } from "../test-utils";
import { createToolHost } from "../tool-host";
import { runScope } from "../use-agent-store";
import { extractJson, runOpenAiCompatibleAgent } from "./openai-runtime";
import type { CustomProvider } from "./types";

const provider: CustomProvider = {
  id: "p1",
  name: "TestAI",
  kind: "openai-compatible",
  baseUrl: "https://llm.test/v1",
  models: [],
  plannerModel: "big-model",
  executorModel: "small-model",
  createdAt: 1,
};

type Body = {
  model: string;
  messages: { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }[];
  tools?: { type: string; function: { name: string; parameters: unknown } }[];
  tool_choice?: string;
  response_format?: unknown;
};
type Reply = Response | Error | ((body: Body) => Response);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const completion = (message: Record<string, unknown>, finish = "stop") =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: finish, message: { role: "assistant", ...message } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  );
const plan = (text = JSON.stringify({ steps: [{ id: "s1", title: "Build", detail: "A card" }] })) =>
  completion({ content: text });
const toolCalls = (...calls: [string, string][]) =>
  completion(
    {
      content: null,
      tool_calls: calls.map(([name, args], i) => ({
        id: `call_${i}`,
        type: "function",
        function: { name, arguments: args },
      })),
    },
    "tool_calls",
  );
const httpError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status });

const state = visible;

const run = (replies: Reply[], signal = new AbortController().signal, apiKey = "sk-test") => {
  const calls: { url: string; headers: Record<string, string>; body: Body }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Body,
    });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected extra API call");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(calls.at(-1)!.body) : reply;
  }) as unknown as typeof fetch;
  const done = runOpenAiCompatibleAgent("make a card", {
    provider,
    apiKey,
    host: createToolHost(),
    signal,
    skillId: null,
  });
  return { calls, done };
};

beforeEach(() => {
  resetStores();
  runScope(null).set({ status: "planning" });
});

describe("extractJson", () => {
  test("handles plain, fenced and chatty JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```\nDone.')).toEqual({ a: { b: "}" } });
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("agent loop", () => {
  test("plan -> tool_calls -> tool messages -> final", async () => {
    const { calls, done } = run([
      plan(),
      toolCalls(["get_document", "{}"]),
      completion({ content: "Card built." }),
    ]);
    await done;

    expect(state().status).toBe("done");
    expect(state().steps.map((s) => [s.id, s.status, s.summary])).toEqual([
      ["s1", "done", "Card built."],
    ]);
    expect(state().usage).toEqual({ inputTokens: 300, outputTokens: 60, costUsd: 0 });

    const [planner, first, second] = calls;
    expect(planner?.url).toBe("https://llm.test/v1/chat/completions");
    expect(planner?.headers.Authorization).toBe("Bearer sk-test");
    expect(planner?.body.model).toBe("big-model");
    expect(planner?.body.response_format).toEqual({ type: "json_object" });
    expect(first?.body.model).toBe("small-model");
    expect(first?.body.tool_choice).toBe("auto");
    expect(first?.body.tools?.[0]).toMatchObject({ type: "function" });
    expect(first?.body.tools?.length).toBeGreaterThan(5);

    const tail = second?.body.messages.slice(-2);
    expect(tail?.[0]).toMatchObject({ role: "assistant" });
    expect(tail?.[1]).toMatchObject({ role: "tool", tool_call_id: "call_0" });
    expect(typeof tail?.[1]?.content).toBe("string");
  });

  test("planner falls back when JSON mode is rejected and extracts JSON from text", async () => {
    const { calls, done } = run([
      httpError(400, "response_format json_object is not supported"),
      plan('Here is the plan:\n```json\n{"steps":[{"id":"s1","title":"Go","detail":""}]}\n```'),
      completion({ content: "ok" }),
    ]);
    await done;
    expect(state().status).toBe("done");
    expect(calls[0]?.body.response_format).toBeDefined();
    expect(calls[1]?.body.response_format).toBeUndefined();
  });

  test("malformed tool arguments and unknown tools become error results for the model", async () => {
    const { calls, done } = run([
      plan(),
      toolCalls(["get_document", "{not json"], ["no_such_tool", "{}"]),
      completion({ content: "recovered" }),
    ]);
    await done;
    expect(state().status).toBe("done");
    const tools = calls[2]?.body.messages.filter((m) => m.role === "tool") ?? [];
    expect(tools).toHaveLength(2);
    expect(String(tools[0]?.content)).toContain("INVALID_JSON");
    expect(String(tools[1]?.content)).toContain("Unknown tool");
    expect(
      state()
        .log.filter((l) => l.kind === "tool")
        .map((l) => l.tool?.isError),
    ).toEqual([true, true]);
  });

  test("an unreadable plan fails the run with a readable message", async () => {
    const { done } = run([plan("I cannot do that")]);
    await done;
    expect(state().status).toBe("failed");
    expect(state().log.at(-1)?.text).toContain("could not be read");
  });

  test("maps HTTP and network errors without leaking the key", async () => {
    const unauthorized = run([httpError(401, "bad key sk-test")]);
    await unauthorized.done;
    expect(state().status).toBe("failed");
    const text = state().log.at(-1)?.text ?? "";
    expect(text).toContain("rejected the API key");
    expect(text).not.toContain("sk-test");

    resetStores();
    runScope(null).set({ status: "planning" });
    await run([new TypeError("Failed to fetch")]).done;
    expect(state().log.at(-1)?.text).toContain("CORS");
  });

  test("a truncated step fails without running its tool calls", async () => {
    const truncated = completion(
      {
        content: null,
        tool_calls: [
          { id: "c", type: "function", function: { name: "get_document", arguments: '{"a"' } },
        ],
      },
      "length",
    );
    await run([plan(), truncated]).done;
    expect(state().status).toBe("failed");
    expect(state().steps[0]?.summary).toContain("cut off");
  });

  test("abort ends the run as cancelled", async () => {
    const controller = new AbortController();
    const { done } = run(
      [
        plan(),
        () => {
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        },
      ],
      controller.signal,
    );
    await done;
    expect(state().status).toBe("cancelled");
    expect(state().steps.every((s) => s.status === "skipped")).toBe(true);
  });
});

describe("images", () => {
  const png = { mediaType: "image/png" as const, data: "AAAA", width: 1, height: 1 };
  const spec = toolByName("get_document");
  const original = spec?.run;
  beforeEach(() => {
    if (spec) spec.run = async () => ({ content: "shot", isError: false, images: [png] });
  });
  afterEach(() => {
    if (spec && original) spec.run = original;
  });

  test("images follow the tool messages in a user message as data URLs", async () => {
    const { calls, done } = run([
      plan(),
      toolCalls(["get_document", "{}"]),
      completion({ content: "ok" }),
    ]);
    await done;
    const last = calls[2]?.body.messages.at(-1);
    expect(last?.role).toBe("user");
    expect(JSON.stringify(last?.content)).toContain("data:image/png;base64,AAAA");
    expect(calls[2]?.body.messages.at(-2)?.role).toBe("tool");
  });

  test("a 400 about images retries once without them and remembers it for the run", async () => {
    const { calls, done } = run([
      plan(),
      toolCalls(["get_document", "{}"]),
      httpError(400, "this model does not support image input"),
      toolCalls(["get_document", "{}"]),
      completion({ content: "ok" }),
    ]);
    await done;
    expect(state().status).toBe("done");
    expect(JSON.stringify(calls[2]?.body.messages)).toContain("image_url");
    expect(JSON.stringify(calls[3]?.body.messages)).not.toContain("image_url");
    // Later screenshots are not sent at all.
    expect(JSON.stringify(calls[4]?.body.messages)).not.toContain("image_url");
  });
});
