import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { agentTools, CLAUDE_CODE_SYSTEM, type RunEvent } from "@pego/agent";
import { SDK_SERVER_NAME } from "./config";
import type { CallTool } from "./editor-hub";
import { createPegoMcpServer } from "./mcp";
import { resolveClaudeExecutable } from "./claude-code";
import { createMapState, describeRunFailure, mapSdkMessage } from "./run-events";

const MAX_TURNS = 60;

/** Env for the Claude Code child: keep the user's login, drop API-key overrides. */
const childEnv = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "pego-bridge/0.0.0";
  return env;
};

/**
 * Agent SDK options: only Pego's tools exist (built-ins disabled, `dontAsk` denies the rest),
 * no settings/CLAUDE.md/skills are loaded, nothing is persisted, and the process runs in an
 * empty scratch directory.
 */
export const buildQueryOptions = (input: {
  cwd: string;
  abortController: AbortController;
  mcpServer: ReturnType<typeof createPegoMcpServer>;
  executable?: string;
}): Options => ({
  abortController: input.abortController,
  cwd: input.cwd,
  systemPrompt: CLAUDE_CODE_SYSTEM,
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
  env: childEnv(),
  ...(input.executable ? { pathToClaudeCodeExecutable: input.executable } : {}),
});

type RunManagerDeps = {
  callTool: CallTool;
  emit: (runId: string, event: RunEvent) => void;
  /** Injectable for tests; defaults to the real Agent SDK. */
  runQuery?: typeof query;
};

/** One Agent SDK run at a time; cancellation via AbortController. */
export const createRunManager = (deps: RunManagerDeps) => {
  const runQuery = deps.runQuery ?? query;
  let active: { runId: string; abort: AbortController } | null = null;

  const start = (runId: string, prompt: string): void => {
    if (active) {
      deps.emit(runId, { kind: "error", message: "Another run is already in progress." });
      return;
    }
    const abort = new AbortController();
    active = { runId, abort };
    void execute(runId, prompt, abort).finally(() => {
      if (active?.runId === runId) active = null;
    });
  };

  const execute = async (runId: string, prompt: string, abort: AbortController) => {
    const state = createMapState();
    let finished = false;
    const emit = (event: RunEvent) => {
      if (event.kind === "done" || event.kind === "error") {
        if (finished) return;
        finished = true;
      }
      deps.emit(runId, event);
    };
    let scratch: string | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "pego-bridge-run-"));
      const mcpServer = createPegoMcpServer({
        callTool: deps.callTool,
        source: () => ({ kind: "run", runId }),
      });
      const stream = runQuery({
        prompt,
        options: buildQueryOptions({
          cwd: scratch,
          abortController: abort,
          mcpServer,
          executable: resolveClaudeExecutable(),
        }),
      });
      for await (const message of stream as AsyncIterable<SDKMessage>) {
        for (const event of mapSdkMessage(message, state)) emit(event);
      }
      if (abort.signal.aborted) emit({ kind: "error", message: "Run cancelled." });
      else emit({ kind: "error", message: "Claude Code ended without a result." });
    } catch (error) {
      emit({
        kind: "error",
        message: abort.signal.aborted ? "Run cancelled." : describeRunFailure(error),
      });
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const cancel = (runId: string): void => {
    if (active?.runId === runId) active.abort.abort();
  };

  const cancelAll = (): void => active?.abort.abort();

  return { start, cancel, cancelAll, isRunning: () => active !== null };
};

export type RunManager = ReturnType<typeof createRunManager>;
