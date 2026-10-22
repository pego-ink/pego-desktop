import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { CLAUDE_CODE_SYSTEM, type LocalAgentId, type RunEvent } from "@pego/agent";
import { agentAdapters } from "./agents/registry";
import { buildChildEnv } from "./agents/env";
import type { AgentAdapter } from "./agents/types";
import type { CallTool } from "./editor-hub";
import { createPegoMcpServer } from "./mcp";

const WORKDIR_PREFIX = "pego-run-";
const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type RunRequest = {
  runId: string;
  prompt: string;
  agentId: LocalAgentId;
  model?: string;
};

export type RunManagerDeps = {
  callTool: CallTool;
  emit: (runId: string, event: RunEvent) => void;
  /** Origin the run-scoped MCP endpoint is served from, e.g. `http://127.0.0.1:4519`. */
  mcpOrigin: () => string;
  /** Defaults to every registered adapter. */
  adapters?: AgentAdapter[];
  /** Environment the child env is derived from (default: the bridge's own). */
  baseEnv?: () => Record<string, string | undefined>;
  /** Parent of the per-run temp directories (default: the OS temp dir). */
  tmpRoot?: string;
};

/** Pull the run token out of `/mcp/run/<token>`; `undefined` when the path has another shape. */
export const parseRunMcpPath = (pathname: string): string | undefined => {
  const prefix = "/mcp/run/";
  if (!pathname.startsWith(prefix)) return undefined;
  const token = pathname.slice(prefix.length);
  return RUN_TOKEN_PATTERN.test(token) ? token : undefined;
};

/**
 * One local-agent run at a time. Per run: an empty temp workdir (removed afterwards), an
 * unguessable run-scoped MCP token (valid only while the run is active) and a child env with
 * API keys stripped. Cancellation aborts the adapter, which kills the CLI's process tree.
 */
export const createRunManager = (deps: RunManagerDeps) => {
  const adapters = deps.adapters ?? agentAdapters;
  const tokens = new Map<string, string>();
  let active: { runId: string; abort: AbortController } | null = null;

  const start = (request: RunRequest): void => {
    const { runId } = request;
    if (active) {
      deps.emit(runId, { kind: "error", message: "Another run is already in progress." });
      return;
    }
    const adapter = adapters.find((candidate) => candidate.id === request.agentId);
    if (!adapter) {
      deps.emit(runId, { kind: "error", message: `Unknown agent "${request.agentId}".` });
      return;
    }
    const abort = new AbortController();
    active = { runId, abort };
    void execute(request, adapter, abort).finally(() => {
      if (active?.runId === runId) active = null;
    });
  };

  const execute = async (request: RunRequest, adapter: AgentAdapter, abort: AbortController) => {
    const { runId } = request;
    let finished = false;
    const emit = (event: RunEvent) => {
      if (finished) return;
      if (event.kind === "done" || event.kind === "error") finished = true;
      deps.emit(runId, event);
    };
    const token = randomBytes(32).toString("base64url");
    let workdir: string | undefined;
    let root: string | undefined;
    try {
      root = await realpath(deps.tmpRoot ?? tmpdir());
      workdir = await mkdtemp(join(root, WORKDIR_PREFIX));
      tokens.set(token, runId);
      await adapter.run({
        runId,
        prompt: request.prompt,
        ...(request.model ? { model: request.model } : {}),
        mcpUrl: `${deps.mcpOrigin()}/mcp/run/${token}`,
        systemPrompt: CLAUDE_CODE_SYSTEM,
        workdir,
        env: buildChildEnv(deps.baseEnv?.() ?? process.env),
        createMcpServer: () =>
          createPegoMcpServer({
            callTool: deps.callTool,
            source: () => ({ kind: "run", runId }),
          }),
        signal: abort.signal,
        emit,
      });
      emit({
        kind: "error",
        message: abort.signal.aborted
          ? "Run cancelled."
          : `${adapter.name} ended without a result.`,
      });
    } catch (error) {
      emit({
        kind: "error",
        message: abort.signal.aborted
          ? "Run cancelled."
          : `${adapter.name} failed: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              500,
            ),
      });
    } finally {
      tokens.delete(token);
      if (workdir && root) await removeWorkdir(workdir, root);
    }
  };

  const cancel = (runId: string): void => {
    if (active?.runId === runId) active.abort.abort();
  };

  const cancelAll = (): void => active?.abort.abort();

  /** Resolves once no run is active (after its process tree is gone and its workdir removed). */
  const whenIdle = async (timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (active && Date.now() < deadline) await Bun.sleep(20);
  };

  return {
    start,
    cancel,
    cancelAll,
    whenIdle,
    isRunning: () => active !== null,
    /** The run a `/mcp/run/<token>` request belongs to, or `undefined` (unknown / run over). */
    resolveRunToken: (token: string): { runId: string } | undefined => {
      const runId = tokens.get(token);
      return runId === undefined ? undefined : { runId };
    },
  };
};

/** Delete a directory this module created, after re-checking it sits directly under `root`. */
const removeWorkdir = async (workdir: string, root: string): Promise<void> => {
  const resolved = await realpath(workdir).catch(() => undefined);
  if (!resolved) return;
  const name = resolved.slice(root.length + 1);
  const safe =
    resolved.startsWith(root + sep) && name.startsWith(WORKDIR_PREFIX) && !name.includes(sep);
  if (!safe) return;
  await rm(resolved, { recursive: true, force: true }).catch(() => undefined);
};

export type RunManager = ReturnType<typeof createRunManager>;
