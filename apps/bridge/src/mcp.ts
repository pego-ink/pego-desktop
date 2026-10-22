import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { agentTools, CLAUDE_CODE_SYSTEM } from "@pego/agent";
import type { CallTool, ToolSource } from "@/editor-hub";

const MAX_TOOL_INPUT_BYTES = 1024 * 1024;

export const toCallToolResult = (outcome: {
  content: string;
  isError: boolean;
}): CallToolResult => ({
  content: [{ type: "text", text: outcome.content }],
  isError: outcome.isError,
});

/**
 * An MCP server exposing every shared agent tool with its raw JSON Schema. It owns no logic:
 * each call is forwarded to the editor via `callTool`. Used both over HTTP (Claude Code in a
 * terminal) and in-process (Agent SDK runs).
 */
export const createPegoMcpServer = (options: {
  callTool: CallTool;
  source: (extra: { clientName?: string }) => ToolSource;
  clientName?: string;
}): McpServer => {
  const server = new McpServer(
    { name: "pego", version: "0.0.0" },
    { instructions: CLAUDE_CODE_SYSTEM || undefined },
  );
  server.server.registerCapabilities({ tools: {} });

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: agentTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { type: "object" as const, ...tool.inputSchema },
    })),
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input } = request.params;
    if (!agentTools.some((tool) => tool.name === name)) {
      return toCallToolResult({ content: `Unknown Pego tool "${name}".`, isError: true });
    }
    if (JSON.stringify(input ?? {}).length > MAX_TOOL_INPUT_BYTES) {
      return toCallToolResult({ content: "Tool input is too large.", isError: true });
    }
    const source = options.source({ clientName: options.clientName });
    return toCallToolResult(await options.callTool(name, input ?? {}, source));
  });

  return server;
};

/** Derive a readable client name from the User-Agent (stateless: no initialize is kept). */
const clientNameOf = (request: Request): string | undefined => {
  const agent = request.headers.get("user-agent")?.trim();
  return agent ? agent.slice(0, 80) : undefined;
};

/**
 * Stateless Streamable HTTP: one server + transport per request (the SDK forbids reusing a
 * stateless transport). JSON responses, so no long-lived SSE streams are held open.
 */
export const handleMcpRequest = async (request: Request, callTool: CallTool): Promise<Response> => {
  const clientName = clientNameOf(request);
  const server = createPegoMcpServer({
    callTool,
    clientName,
    source: ({ clientName: name }) => ({ kind: "mcp", clientName: name }),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 1024 * 1024,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // The response body is already materialised in JSON mode; release the pair.
    void transport.close();
  }
};
