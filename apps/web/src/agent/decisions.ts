import type { DecisionRequest } from "@pego/agent";
import type { RunScope, RunStatus } from "./use-agent-store";

/** Thrown into pending `askUser` promises when the run is cancelled. */
export class RunCancelledError extends Error {
  constructor() {
    super("run cancelled");
    this.name = "RunCancelledError";
  }
}

type Pending = {
  /** The run that asked (null for Claude Code over MCP, which has no run). */
  runId: string | null;
  scope: RunScope;
  resolve: (choice: string) => void;
  reject: (error: Error) => void;
  statusBefore: RunStatus;
};

const pending = new Map<string, Pending>();
let seq = 0;

/** Clear the card of `decisionId` in its session, if that card is still the one shown. */
const clearCard = (scope: RunScope, decisionId: string) => {
  if (scope.get()?.decision?.id === decisionId) scope.set({ decision: null });
};

/**
 * Show a decision card in the run's session and wait for `answerPendingDecision` (or
 * `cancelPendingDecisions`). Each session has its own card.
 */
export const requestDecision = (scope: RunScope, request: DecisionRequest): Promise<string> => {
  const id = `decision-${++seq}`;
  return new Promise<string>((resolve, reject) => {
    const statusBefore = scope.get()?.status ?? "running";
    pending.set(id, { runId: scope.runId, scope, resolve, reject, statusBefore });
    scope.set({ decision: { ...request, id }, status: "awaiting_decision" });
  });
};

/** Where the run that asked `decisionId` writes (to log the answer in its session), if pending. */
export const pendingDecisionScope = (decisionId: string): RunScope | null =>
  pending.get(decisionId)?.scope ?? null;

/** Resolve the decision with the user's choice. Returns false for a stale/unknown id. */
export const answerPendingDecision = (decisionId: string, choice: string): boolean => {
  const entry = pending.get(decisionId);
  if (!entry) return false;
  pending.delete(decisionId);
  clearCard(entry.scope, decisionId);
  entry.scope.set({
    status: entry.statusBefore === "awaiting_decision" ? "running" : entry.statusBefore,
  });
  entry.resolve(choice);
  return true;
};

/** Reject the open decisions of one run, or of every run when `runId` is omitted. */
export const cancelPendingDecisions = (runId?: string | null): void => {
  const matching = [...pending].filter(([, entry]) => runId === undefined || entry.runId === runId);
  for (const [id, entry] of matching) {
    pending.delete(id);
    clearCard(entry.scope, id);
  }
  for (const [, entry] of matching) entry.reject(new RunCancelledError());
};

export const hasPendingDecision = (runId?: string | null): boolean =>
  [...pending.values()].some((entry) => runId === undefined || entry.runId === runId);
