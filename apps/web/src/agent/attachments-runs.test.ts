/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EditorToBridge, RunAttachment } from "@pego/agent";
import { createCompatClient, runApiAgent, type MessagesClient } from "./api-runtime";
import { startLocalAgentRun } from "./local-agent-run";
import { runOpenAiCompatibleAgent } from "./providers/openai-runtime";
import type { CustomProvider } from "./providers/types";
import { resetStores, visible } from "./test-utils";
import { createToolHost } from "./tool-host";
import { runScope, useAgentStore } from "./use-agent-store";

const state = () => useAgentStore.getState();

const attachments: RunAttachment[] = [
  { id: "att-1", name: "photo.png", mediaType: "image/png", data: "AAAA", width: 4, height: 4 },
  { id: "att-2", name: "logo.webp", mediaType: "image/webp", data: "BBBB" },
];

beforeEach(() => {
  resetStores();
  runScope(null).set({ status: "planning" });
});

// ---- Anthropic ------------------------------------------------------------------------------

type Body = Parameters<MessagesClient["beta"]["messages"]["stream"]>[0];
type Message = Awaited<
  ReturnType<ReturnType<MessagesClient["beta"]["messages"]["stream"]>["finalMessage"]>
>;

const reply = (content: unknown[]): Message =>
  ({
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as Message;

const planReply = () =>
  reply([
    {
      type: "text",
      text: JSON.stringify({ steps: [{ id: "s1", title: "Build", detail: "Make a card" }] }),
    },
  ]);

const scriptedClient = (replies: Message[]) => {
  const calls: Body[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        stream: (body) => {
          calls.push(structuredClone(body));
          return {
            finalMessage: async () => {
              const next = replies.shift();
              if (!next) throw new Error("unexpected extra API call");
              return next;
            },
          };
        },
      },
    },
  };
  return { client, calls };
};

const firstUserContent = (body: Body | undefined) => {
  const content = body?.messages[0]?.content;
  if (!Array.isArray(content)) throw new Error("expected content blocks");
  return content as { type: string; text?: string; source?: unknown }[];
};

describe("Anthropic runs", () => {
  const runWith = async (compat: boolean) => {
    const { client, calls } = scriptedClient([
      planReply(),
      reply([{ type: "text", text: "done" }]),
    ]);
    await runApiAgent("use my photo", {
      client,
      host: createToolHost({ attachments }),
      signal: new AbortController().signal,
      skillId: null,
      attachments,
      ...(compat
        ? {
            provider: {
              baseUrl: "https://gw.test",
              apiKey: "k",
              plannerModel: "p",
              executorModel: "e",
              compat: true,
            },
          }
        : {}),
    });
    return calls;
  };

  test("planner and the first executor turn lead with image blocks, then the text", async () => {
    const [planner, executor] = await runWith(false);
    for (const body of [planner, executor]) {
      const content = firstUserContent(body);
      expect(content.map((b) => b.type)).toEqual(["image", "image", "text"]);
      expect(content[0]?.source).toEqual({
        type: "base64",
        media_type: "image/png",
        data: "AAAA",
      });
      expect(content[2]?.text).toContain('att-2 ("logo.webp")');
      expect(content[2]?.text).toContain("use my photo");
    }
    expect(visible().status).toBe("done");
  });

  test("the compat path sends the same plain image blocks without beta fields", async () => {
    const [planner, executor] = await runWith(true);
    for (const body of [planner, executor]) {
      expect(firstUserContent(body).map((b) => b.type)).toEqual(["image", "image", "text"]);
      expect(body?.betas).toBeUndefined();
      expect(body?.fallbacks).toBeUndefined();
    }
  });

  test("without attachments the user turn stays a plain string", async () => {
    const { client, calls } = scriptedClient([
      planReply(),
      reply([{ type: "text", text: "done" }]),
    ]);
    await runApiAgent("x", {
      client,
      host: createToolHost(),
      signal: new AbortController().signal,
      skillId: null,
    });
    expect(typeof calls[0]?.messages[0]?.content).toBe("string");
    expect(typeof calls[1]?.messages[0]?.content).toBe("string");
  });

  test("a compat client forwards image blocks untouched to the SDK", async () => {
    const seen: unknown[] = [];
    const client = createCompatClient(
      { baseUrl: "https://gw.test", apiKey: "k" },
      {
        messages: {
          stream: (body) => {
            seen.push(body);
            return { finalMessage: async () => reply([]) as never };
          },
          create: async () => reply([]) as never,
        },
      },
    );
    await client.beta.messages
      .stream({
        model: "m",
        max_tokens: 1,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
              { type: "text", text: "t" },
            ],
          },
        ],
      })
      .finalMessage();
    expect(JSON.stringify(seen[0])).toContain('"type":"image"');
  });
});

// ---- OpenAI-compatible ----------------------------------------------------------------------

const provider: CustomProvider = {
  id: "p1",
  name: "TestAI",
  kind: "openai-compatible",
  baseUrl: "https://llm.test/v1",
  models: [],
  plannerModel: "big",
  executorModel: "small",
  createdAt: 1,
};

type ChatBody = { messages: { role: string; content: unknown }[] };

describe("OpenAI-compatible runs", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const completion = (content: string) =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );

  const run = async (replies: Response[]) => {
    const bodies: ChatBody[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as ChatBody);
      const next = replies.shift();
      if (!next) throw new Error("unexpected extra API call");
      return next;
    }) as unknown as typeof fetch;
    await runOpenAiCompatibleAgent("use my photo", {
      provider,
      apiKey: "sk",
      host: createToolHost({ attachments }),
      signal: new AbortController().signal,
      skillId: null,
      attachments,
    });
    return bodies;
  };

  const plan = () =>
    completion(JSON.stringify({ steps: [{ id: "s1", title: "Build", detail: "Make a card" }] }));
  const userParts = (body: ChatBody | undefined) =>
    body?.messages.find((m) => m.role === "user")?.content as { type: string; text?: string }[];

  test("planner and the first step turn carry image_url data URLs", async () => {
    const [planner, executor] = await run([plan(), completion("done")]);
    for (const body of [planner, executor]) {
      const parts = userParts(body);
      expect(parts.map((p) => p.type)).toEqual(["text", "image_url", "image_url"]);
      expect(parts[0]?.text).toContain("att-1");
      expect(JSON.stringify(parts[1])).toContain("data:image/png;base64,AAAA");
      expect(JSON.stringify(parts[2])).toContain("data:image/webp;base64,BBBB");
    }
    expect(visible().status).toBe("done");
  });

  test("a provider that rejects images is retried without them and the run goes on", async () => {
    const rejected = new Response(
      JSON.stringify({ error: { message: "this model does not support image input" } }),
      { status: 400 },
    );
    const bodies = await run([rejected, plan(), completion("done")]);
    expect(bodies).toHaveLength(3);
    expect(JSON.stringify(bodies[0])).toContain("image_url");
    expect(JSON.stringify(bodies[1])).not.toContain("image_url");
    expect(JSON.stringify(bodies[2])).not.toContain("image_url");
    expect(visible().log.some((e) => e.text.includes("does not accept images"))).toBe(true);
    expect(visible().status).toBe("done");
  });
});

// ---- local agents ---------------------------------------------------------------------------

describe("local agent runs", () => {
  test("run_start carries the attachments and the prompt names them", async () => {
    useAgentStore.setState({
      bridge: { connected: true, claudeCodeAvailable: true, mcpUrl: "u", agents: [] },
    });
    const sent: EditorToBridge[] = [];
    await startLocalAgentRun("r1", "use my photo", (m) => (sent.push(m), true), null, {
      attachments,
    });
    const start = sent[0];
    if (start?.type !== "run_start") throw new Error("expected run_start");
    expect(start.attachments).toEqual(attachments);
    expect(start.prompt).toContain('att-1 ("photo.png")');
    expect(start.prompt).toEndWith("use my photo");
    // The bubble keeps the user's own text plus the images.
    expect(visible().log[0]).toMatchObject({ kind: "user", text: "use my photo", attachments });
  });

  test("no attachments key without attachments", async () => {
    useAgentStore.setState({
      bridge: { connected: true, claudeCodeAvailable: true, mcpUrl: "u", agents: [] },
    });
    const sent: EditorToBridge[] = [];
    await startLocalAgentRun("r2", "p", (m) => (sent.push(m), true), null);
    expect(sent[0] && "attachments" in sent[0]).toBe(false);
  });
});

// ---- tool host ------------------------------------------------------------------------------

describe("tool host getAttachment", () => {
  test("serves the run's attachments as data URLs and nothing else", () => {
    const host = createToolHost({ attachments });
    expect(host.getAttachment?.("att-2")).toEqual({
      src: "data:image/webp;base64,BBBB",
      name: "logo.webp",
    });
    expect(host.getAttachment?.("att-3")).toBeUndefined();
    expect(createToolHost().getAttachment?.("att-1")).toBeUndefined();
  });
});

// ---- store ----------------------------------------------------------------------------------

describe("pending attachments in the store", () => {
  test("ids are assigned, the limit holds, remove and clear work", () => {
    state().clearAttachments();
    const png = { name: "a.png", mediaType: "image/png" as const, data: "AAAA" };
    for (let i = 0; i < 6; i++) expect(state().addAttachment(png)).toBe(true);
    expect(state().addAttachment(png)).toBe(false);
    expect(state().pendingAttachments.map((a) => a.id)).toEqual([
      "att-1",
      "att-2",
      "att-3",
      "att-4",
      "att-5",
      "att-6",
    ]);
    state().removeAttachment("att-2");
    expect(state().pendingAttachments).toHaveLength(5);
    expect(state().addAttachment(png)).toBe(true);
    expect(state().pendingAttachments.at(-1)?.id).toBe("att-7");
    state().clearAttachments();
    expect(state().pendingAttachments).toEqual([]);
  });
});
