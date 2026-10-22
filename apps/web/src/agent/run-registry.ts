import { MAX_CONCURRENT_RUNS } from "@pego/agent";
import { runClaims } from "./run-claims";
import type { AgentToolHost } from "./tool-host";
import type { AgentBackend } from "./use-agent-store";

/**
 * Runs in flight, at most one per chat session and `MAX_CONCURRENT_RUNS` in total. The store
 * holds what the panel shows; this holds what controls a run (abort, tool host, backend).
 */
export type RunEntry = {
  id: string;
  sessionId: string;
  backend: AgentBackend;
  controller: AbortController;
  host: AgentToolHost;
  /** Explicit style choice of this run (undefined = auto, null = none). */
  styleId: string | null | undefined;
};

const runs = new Map<string, RunEntry>();

export const registerRun = (entry: RunEntry): void => {
  runs.set(entry.id, entry);
};

/** Forget a run that ended and give up the nodes it claimed. */
export const unregisterRun = (runId: string): void => {
  runs.delete(runId);
  runClaims.release(runId);
};

export const getRun = (runId: string): RunEntry | undefined => runs.get(runId);

export const runsForSession = (sessionId: string): RunEntry[] =>
  [...runs.values()].filter((run) => run.sessionId === sessionId);

export const allRuns = (): RunEntry[] => [...runs.values()];

export const activeRunCount = (): number => runs.size;

/** Drop every run (tests, and a fresh editor). Does not abort anything. */
export const clearRuns = (): void => {
  for (const id of runs.keys()) runClaims.release(id);
  runs.clear();
};

export type StartBlock = { reason: "session_busy" | "too_many_runs"; message: string };

/** Why a new run in `sessionId` may not start right now, or null when it may. */
export const startBlock = (
  active: readonly Pick<RunEntry, "sessionId">[],
  sessionId: string,
  max: number = MAX_CONCURRENT_RUNS,
): StartBlock | null => {
  if (active.some((run) => run.sessionId === sessionId)) {
    return {
      reason: "session_busy",
      message: "This chat already has a run in progress. Stop it or wait for it to finish.",
    };
  }
  if (active.length >= max) {
    return {
      reason: "too_many_runs",
      message: `${max} agents are already running. Wait for one to finish or stop one, then send again.`,
    };
  }
  return null;
};
