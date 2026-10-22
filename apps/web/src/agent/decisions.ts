import type { DecisionRequest } from "@pego/agent";
import { useAgentStore, type RunStatus } from "./use-agent-store";

/** Thrown into pending `askUser` promises when the run is cancelled. */
export class RunCancelledError extends Error {
  constructor() {
    super("run cancelled");
    this.name = "RunCancelledError";
  }
}

type Pending = {
  resolve: (choice: string) => void;
  reject: (error: Error) => void;
  statusBefore: RunStatus;
};

const pending = new Map<string, Pending>();
let seq = 0;

/** Show a decision card and wait for `answerPendingDecision` (or `cancelPendingDecisions`). */
export const requestDecision = (request: DecisionRequest): Promise<string> => {
  const id = `decision-${++seq}`;
  return new Promise<string>((resolve, reject) => {
    const { status } = useAgentStore.getState();
    pending.set(id, { resolve, reject, statusBefore: status });
    useAgentStore.getState().set({ decision: { ...request, id }, status: "awaiting_decision" });
  });
};

/** Resolve the decision with the user's choice. Returns false for a stale/unknown id. */
export const answerPendingDecision = (decisionId: string, choice: string): boolean => {
  const entry = pending.get(decisionId);
  if (!entry) return false;
  pending.delete(decisionId);
  const { decision } = useAgentStore.getState();
  useAgentStore.getState().set({
    decision: decision?.id === decisionId ? null : decision,
    status: entry.statusBefore === "awaiting_decision" ? "running" : entry.statusBefore,
  });
  entry.resolve(choice);
  return true;
};

export const cancelPendingDecisions = (): void => {
  const entries = [...pending.values()];
  pending.clear();
  useAgentStore.getState().set({ decision: null });
  for (const entry of entries) entry.reject(new RunCancelledError());
};

export const hasPendingDecision = (): boolean => pending.size > 0;
