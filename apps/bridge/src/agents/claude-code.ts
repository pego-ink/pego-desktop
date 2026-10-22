import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentTools } from "@pego/agent";
import { resolveClaudeExecutable } from "../claude-code";
import { SDK_SERVER_NAME } from "../config";
import { createMapState, describeRunFailure, mapSdkMessage } from "../run-events";
import { extractVersion, runCapture } from "./process";
import type { AgentAttachment } from "../attachments";
import type { AgentAdapter } from "./types";

const MAX_TURNS = 60;
export const CLAUDE_DEFAULT_MODEL = "default";
export const CLAUDE_MODELS = [CLAUDE_DEFAULT_MODEL, "claude-opus-5-5", "claude-sonnet-5-5"];

/**
 * Agent SDK options: only Pego's tools exist (built-ins disabled, `dontAsk` denies the rest),
 * no settings/CLAUDE.md/skills are loaded, nothing is persisted, and the process runs in an
 * empty scratch directory. `env` must already be free of API-key overrides.
 */
export const buildQueryOptions = (input: {
  cwd: string;
  abortController: AbortController;
  mcpServer: McpServer;
  systemPrompt: string;
  env: Record<string, string | undefined>;
  model?: string;
  executable?: string;
}): Options => ({
  abortController: input.abortController,
  cwd: input.cwd,
  systemPrompt: input.systemPrompt,
  tools: [],
  allowedTools: agentTools.map((tool) => `mcp__${SDK_SERVER_NAME}__${tool.name}`),
  mcpServers: {
    [SDK_SERVER_NAME]: { type: "sdk", name: SDK_SERVER_NAME, instance: input.mcpServer },
  },
  strictMcpConfig: true,
  permissionMode: "dontAsk",
  settingSources: [],
  persistSession: false,
  maxTurns: MAX_TURNS,
  env: { ...input.env, CLAUDE_AGENT_SDK_CLIENT_APP: "pego-bridge/0.0.0" },
  ...(input.model && input.model !== CLAUDE_DEFAULT_MODEL ? { model: input.model } : {}),
  ...(input.executable ? { pathToClaudeCodeExecutable: input.executable } : {}),
});

/**
 * The query prompt: a plain string, or - with attachments - one streaming-input user message
 * whose content is the images (base64 blocks, as the Messages API takes them) followed by the text.
 */
export const buildClaudePrompt = (
  prompt: string,
  attachments: readonly Pick<AgentAttachment, "mediaType" | "data">[] = [],
): string | AsyncIterable<SDKUserMessage> => {
  if (attachments.length === 0) return prompt;
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...attachments.map((item) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: item.mediaType, data: item.data },
        })),
        { type: "text" as const, text: prompt },
      ],
    },
  };
  return (async function* () {
    yield message;
  })();
};

export type ClaudeCodeDeps = {
  /** Injectable for tests; defaults to the real Agent SDK. */
  runQuery?: typeof query;
};

export const createClaudeCodeAdapter = (deps: ClaudeCodeDeps = {}): AgentAdapter => ({
  id: "claude-code",
  name: "Claude Code",
  supportsModels: true,

  detect: async (env) => {
    const path = resolveClaudeExecutable();
    if (!path) {
      return {
        installed: false,
        note: "Claude Code was not found. Install it from claude.com/code.",
      };
    }
    const [versionResult, authResult] = await Promise.all([
      runCapture(path, ["--version"], { env, timeoutMs: 5000 }),
      runCapture(path, ["auth", "status"], { env, timeoutMs: 8000 }),
    ]);
    if (versionResult.exitCode !== 0) {
      return {
        installed: false,
        path,
        note: "Claude Code did not start (`claude --version` failed).",
      };
    }
    const info = { installed: true, path, version: extractVersion(versionResult.stdout) };
    // Only the login flag is read; account details in the output are never kept.
    const loggedIn = (() => {
      try {
        return (JSON.parse(authResult.stdout) as { loggedIn?: unknown }).loggedIn === true;
      } catch {
        return undefined;
      }
    })();
    if (loggedIn === false) return { ...info, note: "Not logged in. Run `claude` once to log in." };
    return info;
  },

  listModels: async () => CLAUDE_MODELS,

  run: async (ctx) => {
    if (!ctx.createMcpServer) {
      ctx.emit({ kind: "error", message: "Claude Code needs the in-process Pego MCP server." });
      return;
    }
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    if (ctx.signal.aborted) abort.abort();
    const state = createMapState();
    try {
      const stream = (deps.runQuery ?? query)({
        prompt: buildClaudePrompt(ctx.prompt, ctx.attachments),
        options: buildQueryOptions({
          cwd: ctx.workdir,
          abortController: abort,
          mcpServer: ctx.createMcpServer(),
          systemPrompt: ctx.systemPrompt,
          env: ctx.env,
          ...(ctx.model ? { model: ctx.model } : {}),
          ...(resolveClaudeExecutable() ? { executable: resolveClaudeExecutable() } : {}),
        }),
      });
      let ended = false;
      for await (const message of stream as AsyncIterable<SDKMessage>) {
        for (const event of mapSdkMessage(message, state)) {
          if (event.kind === "done" || event.kind === "error") ended = true;
          ctx.emit(event);
        }
      }
      if (!ended) {
        ctx.emit({
          kind: "error",
          message: ctx.signal.aborted ? "Run cancelled." : "Claude Code ended without a result.",
        });
      }
    } catch (error) {
      ctx.emit({
        kind: "error",
        message: ctx.signal.aborted ? "Run cancelled." : describeRunFailure(error),
      });
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
});

export const claudeCodeAdapter = createClaudeCodeAdapter();
