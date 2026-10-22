import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentAttachment } from "../attachments";
import type { LocalAgentId, LocalAgentInfo, RunEvent } from "@pego/agent";

/** What an adapter gets to run one prompt against the open document. */
export type AgentRunContext = {
  runId: string;
  prompt: string;
  model?: string;
  /**
   * Images the user attached, already validated and written to `workdir/attachments/`. The
   * prompt already ends with a line listing their ids (for `place_image`); adapters only add the
   * CLI-specific way of showing the images to the model.
   */
  attachments?: AgentAttachment[];
  /**
   * Run-scoped MCP endpoint on this bridge (Streamable HTTP). Tool calls made through it are
   * attributed to this run, so plan/step reporting and undo grouping work like panel runs.
   */
  mcpUrl: string;
  /** Pego's system prompt for local agents (CLAUDE_CODE_SYSTEM); pass it however the CLI allows. */
  systemPrompt: string;
  /** Empty temp directory for this run; the CLI runs here and never sees the user's projects. */
  workdir: string;
  /** Environment for the child process (PATH already includes the usual CLI locations). */
  env: Record<string, string>;
  /**
   * Build an in-process Pego MCP server bound to this run (same tools and run attribution as
   * `mcpUrl`). Only adapters that embed their agent (the Claude Agent SDK) need it.
   */
  createMcpServer?: () => McpServer;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
};

export type AgentDetection = Omit<LocalAgentInfo, "id" | "name" | "supportsModels">;

/**
 * One local agent CLI. Adapters must: never modify the user's global CLI config (write any
 * config into `workdir` or pass it via flags/env), restrict the agent to Pego's MCP tools
 * (disable shell/file-edit tools where the CLI allows it), run non-interactively, stream
 * progress as RunEvents, and stop promptly when `signal` aborts.
 */
export type AgentAdapter = {
  id: LocalAgentId;
  name: string;
  supportsModels: boolean;
  detect: (env: Record<string, string>) => Promise<AgentDetection>;
  listModels?: (env: Record<string, string>) => Promise<string[]>;
  /** Resolves when the run ends (emit `done` or `error` before resolving). */
  run: (ctx: AgentRunContext) => Promise<void>;
};
