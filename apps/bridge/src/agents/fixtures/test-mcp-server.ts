import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export type TestMcpServer = {
  /** Streamable HTTP endpoint, e.g. http://127.0.0.1:1234/mcp */
  url: string;
  /** Names of tools the CLI called, in order. */
  calls: string[];
  /** Methods seen on the endpoint (initialize, tools/list, tools/call ...). */
  methods: string[];
  stop: () => void;
};

/** Minimal stateless MCP Streamable HTTP server exposing a single `get_document` tool. */
export const startTestMcpServer = (): TestMcpServer => {
  const calls: string[] = [];
  const methods: string[] = [];
  const buildServer = () => {
    const server = new McpServer({ name: "pego-test", version: "0.0.0" });
    server.registerTool(
      "get_document",
      { description: "Return the open Pego document as JSON." },
      async () => {
        calls.push("get_document");
        return { content: [{ type: "text" as const, text: '{"name":"Test","nodes":[]}' }] };
      },
    );
    return server;
  };
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname !== "/mcp") return new Response("not found", { status: 404 });
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      const body: unknown = await req
        .clone()
        .json()
        .catch(() => undefined);
      for (const message of Array.isArray(body) ? body : [body]) {
        const method = (message as { method?: unknown } | undefined)?.method;
        if (typeof method === "string") methods.push(method);
      }
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await buildServer().connect(transport);
      return transport.handleRequest(req);
    },
  });
  return {
    url: `http://127.0.0.1:${http.port}/mcp`,
    calls,
    methods,
    stop: () => void http.stop(true),
  };
};
