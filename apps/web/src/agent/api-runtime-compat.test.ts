/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  createCompatClient,
  extractJson,
  runApiAgent,
  shouldRetryNonStreaming,
  type ApiProviderConfig,
  type CompatSdk,
  type MessagesClient,
} from "./api-runtime";
import { resetStores } from "./test-utils";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

type Body = Parameters<MessagesClient["beta"]["messages"]["stream"]>[0];
type Message = Awaited<
  ReturnType<ReturnType<MessagesClient["beta"]["messages"]["stream"]>["finalMessage"]>
>;

beforeEach(resetStores);

const message = (over: Record<string, unknown>): Message =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "gw-model",
    content: [],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...over,
  }) as unknown as Message;

const textReply = (text: string) => message({ content: [{ type: "text", text }] });

const fakeClient = (replies: Message[]) => {
  const calls: Body[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        stream: (body) => {
          calls.push(structuredClone(body));
          return {
            finalMessage: async () => {
              const reply = replies.shift();
              if (!reply) throw new Error("unexpected extra API call");
              return reply;
            },
          };
        },
      },
    },
  };
  return { client, calls };
};

const compatProvider: ApiProviderConfig = {
  baseUrl: "https://gw.example.com/anthropic",
  apiKey: "k",
  plannerModel: "gw-planner",
  executorModel: "gw-executor",
  compat: true,
  name: "Gateway",
};

const run = (client: MessagesClient, provider?: ApiProviderConfig) =>
  runApiAgent("make a card", {
    client,
    provider,
    host: createToolHost({ onTransaction: () => {} }),
    signal: new AbortController().signal,
  });

const plan = JSON.stringify({ steps: [{ id: "s1", title: "Build", detail: "card" }] });

describe("compat request shape", () => {
  const compatRun = async (planReply = textReply(plan)) => {
    const { client, calls } = fakeClient([planReply, textReply("done")]);
    await run(client, compatProvider);
    return calls;
  };

  test("uses the provider's models and plain max_tokens + tools", async () => {
    const [planner, executor] = await compatRun();
    expect(planner?.model).toBe("gw-planner");
    expect(executor?.model).toBe("gw-executor");
    expect(planner?.max_tokens).toBeGreaterThan(0);
    expect(executor?.tools?.length).toBeGreaterThan(0);
  });

  test("drops fallbacks, the beta header, effort and top-level cache_control", async () => {
    const calls = await compatRun();
    for (const body of calls) {
      expect(body).not.toHaveProperty("fallbacks");
      expect(body).not.toHaveProperty("betas");
      expect(body).not.toHaveProperty("output_config");
      expect(body).not.toHaveProperty("cache_control");
    }
  });

  test("tools carry no eager_input_streaming", async () => {
    const [, executor] = await compatRun();
    for (const tool of executor?.tools ?? [])
      expect(tool).not.toHaveProperty("eager_input_streaming");
  });

  test("the plan comes back as JSON in text: schema in the system prompt, no structured output", async () => {
    const [planner] = await compatRun();
    expect(typeof planner?.system).toBe("string");
    expect(planner?.system).toContain("JSON Schema");
    expect(planner?.system).toContain('"steps"');
  });

  test("a fenced or chatty JSON plan is still read", async () => {
    await compatRun(textReply(`Here is the plan:\n\`\`\`json\n${plan}\n\`\`\``));
    expect(useAgentStore.getState().status).toBe("done");
    expect(useAgentStore.getState().steps.map((s) => s.id)).toEqual(["s1"]);
  });

  test("an unreadable plan fails the run", async () => {
    const { client } = fakeClient([textReply("no json here")]);
    await run(client, compatProvider);
    expect(useAgentStore.getState().status).toBe("failed");
  });

  test("the official path keeps fallbacks, effort, structured output and eager streaming", async () => {
    const { client, calls } = fakeClient([textReply(plan), textReply("done")]);
    await run(client);
    const [planner, executor] = calls;
    expect(planner).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    expect(planner?.output_config).toMatchObject({
      effort: "high",
      format: { type: "json_schema" },
    });
    expect(executor).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default" });
    expect(executor?.output_config).toEqual({ effort: "medium" });
    expect(executor?.cache_control).toEqual({ type: "ephemeral" });
    expect(executor?.tools?.every((t) => "eager_input_streaming" in t)).toBe(true);
  });

  test("errors name the provider, not Anthropic", async () => {
    const client: MessagesClient = {
      beta: {
        messages: {
          stream: () => ({
            finalMessage: async () => {
              throw new Anthropic.AuthenticationError(401, {}, "bad", new Headers());
            },
          }),
        },
      },
    };
    await run(client, compatProvider);
    const text = useAgentStore.getState().log.find((l) => l.kind === "error")?.text ?? "";
    expect(text).toContain("Gateway");
    expect(text).not.toContain("Anthropic");
  });
});

describe("extractJson", () => {
  test("bare, fenced and embedded objects", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":2}} Hope it helps')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("nothing")).toThrow();
  });
});

describe("compat client streaming fallback", () => {
  const badRequest = () =>
    new Anthropic.BadRequestError(400, {}, "stream not supported", new Headers());

  const fakeSdk = (streamError: Error | null) => {
    const counts = { stream: 0, create: 0 };
    const sdk: CompatSdk = {
      messages: {
        stream: () => {
          counts.stream++;
          return {
            finalMessage: async () => {
              if (streamError) throw streamError;
              return textReply("streamed") as unknown as Anthropic.Message;
            },
          };
        },
        create: async () => {
          counts.create++;
          return textReply("plain") as unknown as Anthropic.Message;
        },
      },
    };
    return { sdk, counts };
  };

  const call = (client: MessagesClient) =>
    client.beta.messages.stream({ model: "m", max_tokens: 1, messages: [] }).finalMessage();

  test("streams when the gateway supports it", async () => {
    const { sdk, counts } = fakeSdk(null);
    await call(createCompatClient({ baseUrl: "x", apiKey: "k" }, sdk));
    expect(counts).toEqual({ stream: 1, create: 0 });
  });

  test("retries once without streaming, then skips streaming for later calls", async () => {
    const { sdk, counts } = fakeSdk(badRequest());
    const client = createCompatClient({ baseUrl: "x", apiKey: "k" }, sdk);
    await call(client);
    await call(client);
    expect(counts).toEqual({ stream: 1, create: 2 });
  });

  test("auth and abort errors are not retried", async () => {
    const auth = new Anthropic.AuthenticationError(401, {}, "no", new Headers());
    const { sdk, counts } = fakeSdk(auth);
    await expect(call(createCompatClient({ baseUrl: "x", apiKey: "k" }, sdk))).rejects.toBe(auth);
    expect(counts.create).toBe(0);
    expect(shouldRetryNonStreaming(new Anthropic.APIUserAbortError())).toBe(false);
    expect(
      shouldRetryNonStreaming(new Anthropic.RateLimitError(429, {}, "slow", new Headers())),
    ).toBe(false);
    expect(shouldRetryNonStreaming(new Anthropic.NotFoundError(404, {}, "nf", new Headers()))).toBe(
      true,
    );
    expect(shouldRetryNonStreaming(new Anthropic.AnthropicError("bad sse"))).toBe(true);
  });
});
