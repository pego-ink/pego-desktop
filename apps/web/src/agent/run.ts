import { useDocumentStore } from "@/store/use-document-store";
import { getActiveRun, getRunTail, setActiveRun, setRunTail } from "./active-run";
import { loadApiKey } from "./api-key";
import { createAnthropicClient, runApiAgent } from "./api-runtime";
import { answerPendingDecision, cancelPendingDecisions } from "./decisions";
import { cancelLocalAgentRun, startLocalAgentRun } from "./local-agent-run";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

/**
 * Agent run entry points used by the agent panel. Dispatches on `useAgentStore().backend`:
 * "api" runs the in-browser Anthropic loop with the user's own key, "local" hands the
 * run to the local bridge (any supported coding-agent CLI). One run at a time.
 */
export const startRun = async (prompt: string): Promise<void> => {
  const text = prompt.trim();
  if (!text || getActiveRun()) return;

  const agent = useAgentStore.getState();
  const runId = crypto.randomUUID();

  if (agent.backend === "local") {
    startLocalAgentRun(runId, text);
    return;
  }

  agent.beginRun(runId, text);
  agent.set({ runLabel: "Anthropic API" });
  agent.appendLog({ kind: "user", text });
  setRunTail(null);

  const apiKey = await loadApiKey();
  if (!apiKey) {
    useAgentStore.getState().appendLog({
      kind: "error",
      text: "No Anthropic API key set. Add one in agent settings.",
    });
    useAgentStore.getState().set({ status: "failed" });
    return;
  }

  const controller = new AbortController();
  const host = createToolHost({ onTransaction: setRunTail });
  setActiveRun({ id: runId, backend: "api", controller, host });
  try {
    await runApiAgent(text, {
      client: createAnthropicClient(apiKey),
      host,
      signal: controller.signal,
    });
  } finally {
    if (getActiveRun()?.id === runId) setActiveRun(null);
  }
};

export const cancelRun = (): void => {
  const active = getActiveRun();
  if (!active) return;
  active.controller.abort();
  cancelPendingDecisions();
  if (active.backend === "local") {
    cancelLocalAgentRun(active.id);
    const state = useAgentStore.getState();
    for (const step of state.steps) {
      if (step.status === "pending" || step.status === "running") {
        state.setStepStatus(step.id, "skipped");
      }
    }
    state.set({ status: "cancelled", decision: null, focusIds: [] });
    setActiveRun(null);
  }
  // API runs finish through `runApiAgent`, which sees the abort and sets "cancelled".
};

/** Answer the pending decision card. */
export const answerDecision = (decisionId: string, choice: string): void => {
  answerPendingDecision(decisionId, choice);
};

/** True when the run's transactions are the newest `transactionCount` entries, all by the agent. */
export const canUndoRunChanges = (): boolean => {
  const { transactionCount } = useAgentStore.getState();
  if (transactionCount <= 0) return false;
  const { past } = useDocumentStore.getState().history;
  if (past.length < transactionCount) return false;
  const tail = getRunTail();
  if (tail && past.at(-1) !== tail) return false;
  return past.slice(-transactionCount).every((tx) => tx.source === "agent");
};

/** Undo every history transaction the last run created, if they are still the newest ones. */
export const undoRunChanges = (): void => {
  if (!canUndoRunChanges()) return;
  const { transactionCount } = useAgentStore.getState();
  for (let i = 0; i < transactionCount; i++) useDocumentStore.getState().undo();
  setRunTail(null);
  useAgentStore.getState().set({ transactionCount: 0, focusIds: [] });
};
