/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { describeApiError } from "./api-errors";
import { checkToolInput, runApiAgent, toToolResultBlock, type MessagesClient } from "./api-runtime";
import { resetStores, visible } from "./test-utils";
import { createToolHost } from "./tool-host";
import { runScope } from "./use-agent-store";
import { toolByName } from "@pego/agent";

type Body = Parameters<MessagesClient["beta"]["messages"]["stream"]>[0];
type Message = Awaited<
  ReturnType<ReturnType<MessagesClient["beta"]["messages"]["stream"]>["finalMessage"]>
>;

const message = (over: Record<string, unknown>): Message =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...over,
  }) as unknown as Message;

const planMessage = (steps = [{ id: "s1", title: "Build it", detail: "Make a card" }]) =>
  message({
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify({ steps }) }],
  });

const toolUse = (name: string, input: unknown, id = `toolu_${name}`) => ({
  type: "tool_use",
  id,
  name,
  input,
});

type Reply = Message | Error | ((body: Body) => Message | Promise<Message>);

/** Scripted client: each call consumes the next reply and records a snapshot of its body. */
const fakeClient = (replies: Reply[]) => {
  const calls: Body[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        stream: (body) => {
          calls.push(structuredClone(body));
          const reply = replies.shift();
          return {
            finalMessage: async () => {
              if (!reply) throw new Error("unexpected extra API call");
              if (reply instanceof Error) throw reply;
              return typeof reply === "function" ? reply(body) : reply;
            },
          };
        },
      },
    },
  };
  return { client, calls };
};

const run = (replies: Reply[], signal = new AbortController().signal) => {
  const fake = fakeClient(replies);
  const host = createToolHost();
  const done = runApiAgent("make a card", { client: fake.client, host, signal });
  return { ...fake, done };
};

const state = visible;

beforeEach(() => {
  resetStores();
  runScope(null).set({ status: "planning" });
});

describe("executor loop", () => {
  test("plans, runs tool_use -> tool_result -> end_turn, and marks the step done", async () => {
    const { done, calls } = run([
      planMessage(),
      message({ content: [toolUse("get_document", {})], stop_reason: "tool_use" }),
      message({ content: [{ type: "text", text: "Card built." }] }),
    ]);
    await done;

    expect(state().status).toBe("done");
    expect(state().steps.map((s) => [s.id, s.status, s.summary])).toEqual([
      ["s1", "done", "Card built."],
    ]);
    expect(calls).toHaveLength(3);

    // Planner: Opus 5.5, structured output, high effort, fallbacks on.
    const [planner, first, second] = calls;
    expect(planner?.model).toBe("claude-opus-5-5");
    expect(planner?.output_config?.effort).toBe("high");
    expect(planner?.output_config?.format?.type).toBe("json_schema");
    expect(planner?.fallbacks).toBe("default");
    expect(planner?.betas).toContain("server-side-fallback-2026-07-01");

    // Executor: Sonnet 5.5, eager tool streaming, cached stable prefix, fallbacks on.
    expect(first?.model).toBe("claude-sonnet-5-5");
    expect(first?.output_config?.effort).toBe("medium");
    expect(first?.fallbacks).toBe("default");
    expect(first?.tools?.length).toBeGreaterThan(0);
    for (const tool of first?.tools ?? []) {
      expect((tool as { eager_input_streaming?: boolean }).eager_input_streaming).toBe(true);
    }
    expect(JSON.stringify(first?.system)).toContain("cache_control");
    expect(first?.thinking).toBeUndefined();

    // The loop sent the assistant turn back verbatim plus ALL tool_results in one user message.
    const turn = second?.messages.at(-1);
    expect(turn?.role).toBe("user");
    const results = turn?.content as { type: string; tool_use_id: string; is_error?: boolean }[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_get_document" });
    expect(results[0]?.is_error).toBeUndefined();
    expect(second?.messages.at(-2)?.role).toBe("assistant");
  });

  test("returns every tool_result in a single user message and keeps the model's own report", async () => {
    const { done, calls } = run([
      planMessage(),
      message({
        content: [
          toolUse("get_document", {}, "toolu_a"),
          toolUse("report_step", { stepId: "s1", status: "done", summary: "Reported" }, "toolu_b"),
        ],
        stop_reason: "tool_use",
      }),
      message({ content: [{ type: "text", text: "closing line" }] }),
    ]);
    await done;
    const results = calls[2]?.messages.at(-1)?.content as { tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_a", "toolu_b"]);
    expect(state().steps[0]).toMatchObject({ status: "done", summary: "Reported" });
  });

  test("a truncated tool input is rejected before the tool runs", async () => {
    const { done, calls } = run([
      planMessage(),
      message({ content: [toolUse("update_node", { id: "rect-1" })], stop_reason: "tool_use" }),
      message({ content: [{ type: "text", text: "gave up" }] }),
    ]);
    await done;
    const [result] = calls[2]?.messages.at(-1)?.content as {
      is_error?: boolean;
      content: string;
    }[];
    expect(result?.is_error).toBe(true);
    expect(result?.content).toContain("INVALID_JSON");
    expect(state().log.some((l) => l.kind === "tool" && l.tool?.isError)).toBe(true);
  });

  test("unknown tools come back as is_error results", async () => {
    const { done, calls } = run([
      planMessage(),
      message({ content: [toolUse("nope", {})], stop_reason: "tool_use" }),
      message({ content: [] }),
    ]);
    await done;
    const [result] = calls[2]?.messages.at(-1)?.content as { is_error?: boolean }[];
    expect(result?.is_error).toBe(true);
  });

  test("max_tokens fails the step without running the cut-off tool call", async () => {
    const { done, calls } = run([
      planMessage([
        { id: "s1", title: "A", detail: "" },
        { id: "s2", title: "B", detail: "" },
      ]),
      message({
        content: [toolUse("update_node", { id: "rect-1", props: { fill: "#fff" } })],
        stop_reason: "max_tokens",
      }),
    ]);
    await done;
    expect(calls).toHaveLength(2);
    expect(state().status).toBe("failed");
    expect(state().steps.map((s) => s.status)).toEqual(["failed", "skipped"]);
    expect(state().log.at(-1)?.text).toContain("max_tokens");
  });

  test("a refusal on the executor fails the step and shows the category", async () => {
    const { done } = run([
      planMessage(),
      message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }),
    ]);
    await done;
    expect(state().status).toBe("failed");
    expect(state().log.at(-1)?.text).toContain("cyber");
  });

  test("pause_turn resumes with the paused assistant turn", async () => {
    const { done, calls } = run([
      planMessage(),
      message({ content: [{ type: "text", text: "thinking" }], stop_reason: "pause_turn" }),
      message({ content: [{ type: "text", text: "all done" }] }),
    ]);
    await done;
    expect(state().status).toBe("done");
    expect(calls[2]?.messages.at(-1)?.role).toBe("assistant");
  });

  test("usage and cost accumulate per model price", async () => {
    const { done } = run([
      planMessage(),
      message({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_read_input_tokens: 1_000_000,
          cache_creation_input_tokens: 0,
        },
      }),
    ]);
    await done;
    // planner: 1000 in, 500 out on Opus; executor: 1M in + 1M cache read + 100K out on Sonnet.
    const opus = (1000 * 4 + 500 * 20) / 1e6;
    const sonnet = (1e6 * 2 + 1e6 * 0.2 + 1e5 * 10) / 1e6;
    expect(state().usage.costUsd).toBeCloseTo(opus + sonnet, 6);
    expect(state().usage.inputTokens).toBe(1000 + 2_000_000);
    expect(state().usage.outputTokens).toBe(500 + 100_000);
  });
});

describe("error paths", () => {
  test("invalid API key ends the run with a clear message", async () => {
    const { done } = run([
      new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()),
    ]);
    await done;
    expect(state().status).toBe("failed");
    expect(state().log.at(-1)).toMatchObject({
      kind: "error",
      text: expect.stringContaining("API key invalid"),
    });
  });

  test("rate limit surfaces the retry hint", () => {
    const error = new Anthropic.RateLimitError(
      429,
      undefined,
      "slow",
      new Headers({ "retry-after": "7" }),
    );
    expect(describeApiError(error)).toContain("7s");
  });

  test("a refused plan fails the run", async () => {
    const { done } = run([
      message({
        model: "claude-opus-5-5",
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "bio" },
      }),
    ]);
    await done;
    expect(state().status).toBe("failed");
    expect(state().log.at(-1)?.text).toContain("bio");
  });

  test("an unreadable plan fails the run", async () => {
    const { done } = run([
      message({ model: "claude-opus-5-5", content: [{ type: "text", text: "not json" }] }),
    ]);
    await done;
    expect(state().status).toBe("failed");
  });

  test("abort during a step cancels the run and skips unfinished steps", async () => {
    const controller = new AbortController();
    const { done } = run(
      [
        planMessage(),
        () => {
          controller.abort();
          throw new Anthropic.APIUserAbortError();
        },
      ],
      controller.signal,
    );
    await done;
    expect(state().status).toBe("cancelled");
    expect(state().steps[0]?.status).toBe("skipped");
  });
});

describe("checkToolInput", () => {
  const spec = toolByName("update_node")!;
  test("flags non-objects and missing required fields", () => {
    expect(checkToolInput(spec, "x")).toContain("object");
    expect(checkToolInput(spec, { id: "a" })).toContain("props");
    expect(checkToolInput(spec, { id: "a", props: {} })).toBeNull();
  });
});

describe("toToolResultBlock", () => {
  const image = { mediaType: "image/png" as const, data: "AAAA", width: 4, height: 3 };

  test("images become base64 image blocks before the text block", () => {
    const block = toToolResultBlock("toolu_1", {
      content: "done",
      isError: false,
      images: [image],
    });
    expect(block).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "text", text: "done" },
      ],
    });
  });

  test("without images the content stays a plain string; errors set is_error", () => {
    expect(toToolResultBlock("t", { content: "x", isError: false })).toEqual({
      type: "tool_result",
      tool_use_id: "t",
      content: "x",
    });
    expect(toToolResultBlock("t", { content: "x", isError: true, images: [] })).toMatchObject({
      content: "x",
      is_error: true,
    });
  });
});
