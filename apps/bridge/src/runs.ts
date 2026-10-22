import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  CLAUDE_CODE_SYSTEM,
  MAX_CONCURRENT_RUNS,
  type LocalAgentId,
  type RunAttachment,
  type RunEvent,
} from "@pego/agent";
import { attachmentPromptNote, writeAttachments, type AgentAttachment } from "./attachments";
import { agentAdapters } from "./agents/registry";
import { buildChildEnv } from "./agents/env";
import type { AgentAdapter, SteerMessage } from "./agents/types";
import type { CallTool } from "./editor-hub";
import { createPegoMcpServer } from "./mcp";

const WORKDIR_PREFIX = "pego-run-";
const RUN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type RunRequest = {
  runId: string;
  prompt: string;
  agentId: LocalAgentId;
  model?: string;
  /** Validated composer images; written to the run's workdir before the adapter starts. */
  attachments?: RunAttachment[];
};

export type SteerRequest = { text: string; attachments?: RunAttachment[] };
/** `delivered`; `unsupported` (adapter has no native steer); `unknown` (no such live run). */
export type SteerResult = "delivered" | "unsupported" | "unknown";

type ActiveRun = {
  abort: AbortController;
  adapter: AgentAdapter;
  workdir?: string;
  finished: boolean;
  steerCount: number;
  steerHandler?: (steer: SteerMessage) => boolean;
  /** Steer messages that arrived before the adapter registered its handler. */
  steerBuffer: SteerMessage[];
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
 * Up to MAX_CONCURRENT_RUNS local-agent runs at once, keyed by run id. Per run: an empty temp workdir (removed afterwards), an
 * unguessable run-scoped MCP token (valid only while the run is active) and a child env with
 * API keys stripped. Cancellation aborts the adapter, which kills the CLI's process tree.
 */
export const createRunManager = (deps: RunManagerDeps) => {
  const adapters = deps.adapters ?? agentAdapters;
  const tokens = new Map<string, string>();
  const active = new Map<string, ActiveRun>();

  const start = (request: RunRequest): void => {
    const { runId } = request;
    if (active.has(runId)) {
      deps.emit(runId, { kind: "error", message: "A run with this id is already in progress." });
      return;
    }
    if (active.size >= MAX_CONCURRENT_RUNS) {
      deps.emit(runId, {
        kind: "error",
        message: `Too many runs in progress (max ${MAX_CONCURRENT_RUNS}). Wait for one to finish.`,
      });
      return;
    }
    const adapter = adapters.find((candidate) => candidate.id === request.agentId);
    if (!adapter) {
      deps.emit(runId, { kind: "error", message: `Unknown agent "${request.agentId}".` });
      return;
    }
    const run: ActiveRun = {
      abort: new AbortController(),
      adapter,
      finished: false,
      steerCount: 0,
      steerBuffer: [],
    };
    active.set(runId, run);
    void execute(request, run).finally(() => {
      if (active.get(runId) === run) active.delete(runId);
    });
  };

  const execute = async (request: RunRequest, run: ActiveRun) => {
    const { runId } = request;
    const { adapter, abort } = run;
    let finished = false;
    const emit = (event: RunEvent) => {
      if (finished) return;
      if (event.kind === "done" || event.kind === "error") {
        finished = true;
        run.finished = true;
      }
      deps.emit(runId, event);
    };
    const token = randomBytes(32).toString("base64url");
    let workdir: string | undefined;
    let root: string | undefined;
    try {
      root = await realpath(deps.tmpRoot ?? tmpdir());
      workdir = await mkdtemp(join(root, WORKDIR_PREFIX));
      run.workdir = workdir;
      const attachments = await writeAttachments(workdir, request.attachments ?? []);
      tokens.set(token, runId);
      await adapter.run({
        runId,
        prompt: `${request.prompt}${attachmentPromptNote(attachments)}`,
        ...(attachments.length > 0 ? { attachments } : {}),
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
        onSteer: (handler) => {
          run.steerHandler = handler;
          for (const buffered of run.steerBuffer.splice(0)) handler(buffered);
        },
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

  const cancel = (runId: string): void => active.get(runId)?.abort.abort();

  const cancelAll = (): void => {
    for (const run of active.values()) run.abort.abort();
  };

  /** Resolves once no run is active (after process trees are gone and workdirs removed). */
  const whenIdle = async (timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (active.size > 0 && Date.now() < deadline) await Bun.sleep(20);
  };

  /** Hand a steer message to a live run whose adapter takes it natively. */
  const steer = async (runId: string, request: SteerRequest): Promise<SteerResult> => {
    const run = active.get(runId);
    if (!run || run.finished || !run.workdir) return "unknown";
    if (run.adapter.steer !== "native") return "unsupported";
    const sequence = (run.steerCount += 1);
    // Own subdirectory per steer message: attachment ids (att-1...) restart for every message.
    const dir = `steer-${sequence}`;
    const written = await writeAttachments(join(run.workdir, dir), request.attachments ?? []).catch(
      () => undefined,
    );
    if (!written || run.finished) return "unknown";
    const attachments: AgentAttachment[] = written.map((item) => ({
      ...item,
      relativePath: `${dir}/${item.relativePath}`,
    }));
    const message: SteerMessage = {
      text: `${request.text}${attachmentPromptNote(attachments)}`,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    if (run.steerHandler) {
      if (!run.steerHandler(message)) return "unknown";
    } else run.steerBuffer.push(message);
    deps.emit(runId, { kind: "steered", text: request.text });
    return "delivered";
  };

  return {
    start,
    cancel,
    cancelAll,
    whenIdle,
    steer,
    isRunning: () => active.size > 0,
    activeCount: () => active.size,
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
