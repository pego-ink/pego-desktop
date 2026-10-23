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
import { agentTools, CLAUDE_CODE_SYSTEM, toolAnnotations, type ProjectTarget } from "@pego/agent";
import type { CallTool, ToolOutcome, ToolSource } from "./editor-hub";
import { getPegoPrompt, pegoPrompts } from "./mcp-prompts";
import { listPegoResources, readPegoResource } from "./mcp-resources";
import { FILE_TOOLS, FILE_TOOLS_INSTRUCTIONS, isFileTool, runFileTool } from "./file-tools";
import { findProject, listProjects } from "./projects";

/** The `project` argument every agent tool takes over the terminal endpoint. */
const PROJECT_PARAM = {
  type: "string",
  description:
    "Optional id or name of the design project to edit (list_projects shows them). It is edited in the background when the editor shows another one. Omit it to edit the document shown in the editor.",
} as const;

/** An agent tool's JSON Schema with the `project` argument added. */
const withProjectParam = (schema: Record<string, unknown>) => ({
  ...schema,
  properties: {
    ...(schema.properties as Record<string, unknown> | undefined),
    project: PROJECT_PARAM,
  },
});

/**
 * Split the `project` argument off a tool call and resolve it in the design folder. Returns the
 * input without it, and the project (or an error to show the agent).
 */
export const resolveProjectArg = async (
  input: Record<string, unknown>,
  designDir: string | null,
): Promise<{ input: Record<string, unknown>; project?: ProjectTarget } | { error: string }> => {
  const { project: query, ...rest } = input;
  if (query === undefined) return { input: rest };
  if (typeof query !== "string" || !query.trim())
    return { error: "project must be an id or a name." };
  if (!designDir) return { error: "This bridge has no design folder, so it has no projects." };
  const projects = await listProjects(designDir);
  const found = findProject(projects, query);
  if (!("project" in found)) {
    const names = (found.matches.length > 1 ? found.matches : projects)
      .map((project) => `${project.name} (id ${project.id})`)
      .join(", ");
    return {
      error:
        found.matches.length > 1
          ? `"${query}" matches several projects; use an id: ${names}.`
          : `No project "${query}". Projects: ${names || "none"}.`,
    };
  }
  const { id, name, dir, mainFile, hasMainFile } = found.project;
  return { input: rest, project: { id, name, dir, mainFile, hasMainFile } };
};

const MAX_TOOL_INPUT_BYTES = 1024 * 1024;
/** Reported to MCP clients; bump with user-visible changes to the tool surface. */
export const PEGO_MCP_VERSION = "0.2.0";

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
  /** The project's design folder for list_documents. */
  designDir?: string | null;
}): McpServer => {
  const fileTools = options.fileTools ? FILE_TOOLS : [];
  const instructions = options.fileTools
    ? `${CLAUDE_CODE_SYSTEM}\n\n${FILE_TOOLS_INSTRUCTIONS}`
    : CLAUDE_CODE_SYSTEM;
  const server = new McpServer(
    { name: "pego", version: PEGO_MCP_VERSION },
    { instructions: instructions || undefined },
  );
  server.server.registerCapabilities({ tools: {}, resources: {}, prompts: {} });
  const sourceOf = () => options.source({ clientName: options.clientName });
  // The terminal endpoint (with the file tools) lets every agent tool name the project it edits.
  const projectTargets = options.fileTools === true;

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: agentTools
      .map((tool) => {
        const annotations = toolAnnotations(tool.name);
        return {
          name: tool.name,
          title: annotations.title,
          description: tool.description,
          inputSchema: {
            type: "object" as const,
            ...(projectTargets ? withProjectParam(tool.inputSchema) : tool.inputSchema),
          },
          annotations,
        };
      })
      .concat(fileTools),
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
    const source = sourceOf();
    if (projectTargets && source.kind === "mcp") {
      const resolved = await resolveProjectArg(input ?? {}, options.designDir ?? null);
      if ("error" in resolved) return toCallToolResult({ content: resolved.error, isError: true });
      return toCallToolResult(
        await options.callTool(name, resolved.input, {
          ...source,
          ...(resolved.project ? { project: resolved.project } : {}),
        }),
      );
    }
    return toCallToolResult(await options.callTool(name, input ?? {}, source));
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
  options: {
    /** Fixed attribution for run-scoped endpoints (no file tools); defaults to the MCP client. */
    fixedSource?: ToolSource;
    /** The project's design folder for the file tools; they are served only without fixedSource. */
    designDir?: string | null;
  } = {},
): Promise<Response> => {
  const clientName = clientNameOf(request);
  const server = createPegoMcpServer({
    callTool,
    clientName,
    source: ({ clientName: name }) => options.fixedSource ?? { kind: "mcp", clientName: name },
    fileTools: options.fixedSource === undefined,
    designDir: options.designDir ?? null,
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
