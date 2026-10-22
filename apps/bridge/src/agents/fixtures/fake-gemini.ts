export type FakeGemini = {
  /** Value for GOOGLE_GEMINI_BASE_URL. */
  baseUrl: string;
  /** Function declaration names offered in each model request, in request order. */
  toolNameLists: string[][];
  /** Raw request bodies of generateContent calls. */
  requests: unknown[];
  stop: () => void;
};

type GeminiBody = {
  contents?: { role?: string; parts?: { functionResponse?: unknown }[] }[];
  tools?: { functionDeclarations?: { name?: string }[] }[];
};

const usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 };

const reply = (parts: object[]) => ({
  candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }],
  usageMetadata,
});

/** Gemini API stand-in: calls the tool ending in `get_document` once, then says DONE. */
export const startFakeGemini = (): FakeGemini => {
  const requests: unknown[] = [];
  const toolNameLists: string[][] = [];
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      const body = (await req.json().catch(() => ({}))) as GeminiBody;
      if (path.endsWith(":countTokens")) return Response.json({ totalTokens: 10 });
      if (!path.includes(":generateContent") && !path.includes(":streamGenerateContent")) {
        return Response.json({}, { status: 404 });
      }
      requests.push(body);
      const names = (body.tools ?? []).flatMap((t) =>
        (t.functionDeclarations ?? []).flatMap((d) => (d.name ? [d.name] : [])),
      );
      toolNameLists.push(names);
      const toolName = names.find((n) => n.endsWith("get_document"));
      const afterTool = (body.contents ?? []).some((c) =>
        (c.parts ?? []).some((p) => p.functionResponse !== undefined),
      );
      const payload =
        toolName && !afterTool
          ? reply([{ functionCall: { name: toolName, args: {} } }])
          : reply([{ text: "DONE" }]);
      if (path.includes(":streamGenerateContent")) {
        return new Response(`data: ${JSON.stringify(payload)}\r\n\r\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return Response.json(payload);
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${http.port}`,
    toolNameLists,
    requests,
    stop: () => void http.stop(true),
  };
};
