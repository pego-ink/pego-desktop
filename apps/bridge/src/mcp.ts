import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { agentTools, CLAUDE_CODE_SYSTEM } from "@pego/agent";
import type { CallTool, ToolOutcome, ToolSource } from "./editor-hub";
import { getPegoPrompt, pegoPrompts } from "./mcp-prompts";
import { listPegoResources, readPegoResource } from "./mcp-resources";
import { FILE_TOOLS, FILE_TOOLS_INSTRUCTIONS, isFileTool, runFileTool } from "./file-tools";
import { resolveProjectTarget, takeProjectArg, withProjectParam } from "./project-target";

const MAX_TOOL_INPUT_BYTES = 1024 * 1024;

/** Images (screenshots) come first so a client that truncates still sees them, then the text. */
export const toCallToolResult = (outcome: ToolOutcome): CallToolResult => ({
  content: [
    ...(outcome.images ?? []).map((image) => ({
      type: "image" as const,
      data: image.data,
      mimeType: image.mediaType,
    })),
    { type: "text" as const, text: outcome.content },
  ],
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
  /** Also serve the file tools (read and write design files on this machine). */
  fileTools?: boolean;
  /** The design folder holding the projects. */
  designDir?: string | null;
}): McpServer => {
  const fileTools = options.fileTools ? FILE_TOOLS : [];
  const instructions = options.fileTools
    ? `${CLAUDE_CODE_SYSTEM}\n\n${FILE_TOOLS_INSTRUCTIONS}`
    : CLAUDE_CODE_SYSTEM;
  const server = new McpServer(
    { name: "pego", version: "0.0.0" },
    { instructions: instructions || undefined },
  );
  server.server.registerCapabilities({ tools: {}, resources: {}, prompts: {} });
  const sourceOf = () => options.source({ clientName: options.clientName });

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...agentTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: options.fileTools
          ? withProjectParam({ type: "object" as const, ...tool.inputSchema })
          : { type: "object" as const, ...tool.inputSchema },
      })),
      ...fileTools,
    ],
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input } = request.params;
    if (options.fileTools && isFileTool(name)) {
      return toCallToolResult(
        await runFileTool(
          name,
          input ?? {},
          options.callTool,
          sourceOf(),
          options.designDir ?? null,
        ),
      );
    }
    if (!agentTools.some((tool) => tool.name === name)) {
      return toCallToolResult({ content: `Unknown Pego tool "${name}".`, isError: true });
    }
    if (JSON.stringify(input ?? {}).length > MAX_TOOL_INPUT_BYTES) {
      return toCallToolResult({ content: "Tool input is too large.", isError: true });
    }
    if (!options.fileTools) {
      return toCallToolResult(await options.callTool(name, input ?? {}, sourceOf()));
    }
    // `project` targets a project's design without showing it in the window.
    const split = takeProjectArg(input ?? {});
    if (split.invalid) {
      return toCallToolResult({ content: "project must be a project id or name.", isError: true });
    }
    if (!split.project)
      return toCallToolResult(await options.callTool(name, split.input, sourceOf()));
    const resolved = await resolveProjectTarget(options.designDir ?? null, split.project);
    if ("error" in resolved) return toCallToolResult({ content: resolved.error, isError: true });
    return toCallToolResult(await options.callTool(name, split.input, sourceOf(), resolved.target));
  });

  server.server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: listPegoResources(),
  }));

  server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const result = await readPegoResource(request.params.uri, options.callTool, sourceOf());
    if (!result) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource "${request.params.uri}".`);
    }
    return result;
  });

  server.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: pegoPrompts }));

  server.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    let result;
    try {
      result = getPegoPrompt(name, args);
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidParams,
        error instanceof Error ? error.message : "Invalid arguments",
      );
    }
    if (!result) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${name}".`);
    return result;
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
export const handleMcpRequest = async (
  request: Request,
  callTool: CallTool,
  /** Fixed attribution for run-scoped endpoints; defaults to the calling MCP client. */
  fixedSource?: ToolSource,
  /** Serve the file tools with this design folder (the terminal endpoint, not runs). */
  files?: { designDir: string | null },
): Promise<Response> => {
  const clientName = clientNameOf(request);
  const server = createPegoMcpServer({
    callTool,
    clientName,
    source: ({ clientName: name }) => fixedSource ?? { kind: "mcp", clientName: name },
    fileTools: files !== undefined,
    designDir: files?.designDir ?? null,
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
