export type FakeOpenAi = {
  baseUrl: string;
  /** Tool names declared in the most recent request. */
  toolNames: () => string[];
  /** Raw request bodies. */
  requests: unknown[];
  stop: () => void;
};

type ChatBody = {
  tools?: { function?: { name?: string } }[];
  messages?: { role?: string }[];
};

const sse = (chunks: unknown[]): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });

const chunk = (delta: object, finish: string | null = null, usage?: object) => ({
  id: "chatcmpl-fake",
  object: "chat.completion.chunk",
  created: 0,
  model: "fake",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

/** OpenAI-compatible chat server: calls the tool ending in `get_document` once, then says DONE. */
export const startFakeOpenAi = (): FakeOpenAi => {
  const requests: unknown[] = [];
  let lastTools: string[] = [];
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (!path.endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      const body = (await req.json()) as ChatBody;
      requests.push(body);
      lastTools = (body.tools ?? []).flatMap((t) => (t.function?.name ? [t.function.name] : []));
      const toolName = lastTools.find((n) => n.endsWith("get_document"));
      const afterTool = (body.messages ?? []).some((m) => m.role === "tool");
      const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };
      if (toolName && !afterTool) {
        return sse([
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: toolName, arguments: "{}" },
              },
            ],
          }),
          chunk({}, "tool_calls", usage),
        ]);
      }
      return sse([chunk({ role: "assistant", content: "DONE" }), chunk({}, "stop", usage)]);
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${http.port}/v1`,
    toolNames: () => lastTools,
    requests,
    stop: () => void http.stop(true),
  };
};
