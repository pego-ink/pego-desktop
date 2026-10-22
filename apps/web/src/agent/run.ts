import type { RunAttachment } from "@pego/agent";
import { useDocumentStore } from "@/store/use-document-store";
import { getActiveRun, getRunTail, setActiveRun, setRunTail } from "./active-run";
import { loadApiKey } from "./api-key";
import { createAnthropicClient, createCompatClient, runApiAgent } from "./api-runtime";
import { answerPendingDecision, cancelPendingDecisions } from "./decisions";
import { cancelLocalAgentRun, startLocalAgentRun } from "./local-agent-run";
import { isLocalBaseUrl } from "./provider-url";
import { listCustomProviders, loadProviderKey } from "./providers/store";
import { runOpenAiCompatibleAgent } from "./providers/openai-runtime";
import { setRunStyleId } from "./run-skills";
import { buildHistoryBlock } from "./sessions/session-context";
import { createToolHost } from "./tool-host";
import { sessionTurns, useAgentStore } from "./use-agent-store";

/**
 * Agent run entry points used by the agent panel. Dispatches on `useAgentStore().backend`:
 * "api" runs the in-browser Anthropic loop with the user's own key, "local" hands the
 * run to the local bridge (any supported coding-agent CLI), "custom" runs a user-added
 * OpenAI- or Anthropic-compatible provider in the browser. One run at a time.
 */

/** What the custom dispatch reaches out to; tests pass fakes. */
export type CustomRunDeps = {
  listProviders: typeof listCustomProviders;
  loadKey: typeof loadProviderKey;
  runOpenAi: typeof runOpenAiCompatibleAgent;
  runAnthropic: typeof runApiAgent;
};

const defaultCustomDeps: CustomRunDeps = {
  listProviders: listCustomProviders,
  loadKey: loadProviderKey,
  runOpenAi: runOpenAiCompatibleAgent,
  runAnthropic: runApiAgent,
};

/** The user bubble of the activity log (carries the attached images, if any). */
const userLogEntry = (text: string, attachments: readonly RunAttachment[]) => ({
  kind: "user" as const,
  text,
  ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
});

/**
 * Backend "custom": load the selected provider and its key, then route by dialect. Same store
 * contract as the "api" backend (the runtimes never throw and end the run in the store), so
 * cancel and undo-all work unchanged.
 */
export const startCustomRun = async (
  runId: string,
  text: string,
  skillId: string | null | undefined,
  deps: CustomRunDeps = defaultCustomDeps,
  attachments: readonly RunAttachment[] = [],
  history = "",
): Promise<void> => {
  const agent = useAgentStore.getState();
  agent.beginRun(runId, text);
  agent.set({ runLabel: "Custom provider" });
  agent.appendLog(userLogEntry(text, attachments));
  setRunTail(null);

  const fail = (message: string) => {
    const state = useAgentStore.getState();
    state.appendLog({ kind: "error", text: message });
    state.set({ status: "failed" });
  };

  const providerId = agent.customProviderId;
  const provider = providerId
    ? (await deps.listProviders().catch(() => [])).find((p) => p.id === providerId)
    : undefined;
  if (!provider) {
    return fail("The selected custom provider no longer exists. Pick another in Model settings.");
  }
  const key = (await deps.loadKey(provider.id).catch(() => null)) ?? "";
  // Local servers (Ollama, LM Studio) usually need no key; everything else does.
  if (!key && !isLocalBaseUrl(provider.baseUrl)) {
    return fail(`No API key set for ${provider.name}. Add one in Model settings.`);
  }
  useAgentStore.getState().set({ runLabel: `${provider.name} · ${provider.executorModel}` });

  const controller = new AbortController();
  const host = createToolHost({ onTransaction: setRunTail, attachments });
  setActiveRun({ id: runId, backend: "custom", controller, host });
  try {
    if (provider.kind === "openai-compatible") {
      await deps.runOpenAi(text, {
        provider,
        apiKey: key,
        host,
        signal: controller.signal,
        skillId,
        attachments,
        history,
      });
    } else {
      await deps.runAnthropic(text, {
        client: createCompatClient({ baseUrl: provider.baseUrl, apiKey: key }),
        provider: {
          baseUrl: provider.baseUrl,
          apiKey: key,
          plannerModel: provider.plannerModel || provider.executorModel,
          executorModel: provider.executorModel,
          compat: true,
          name: provider.name,
        },
        host,
        signal: controller.signal,
        skillId,
        attachments,
        history,
      });
    }
  } finally {
    if (getActiveRun()?.id === runId) setActiveRun(null);
  }
};
export const startRun = async (prompt: string): Promise<void> => {
  const text = prompt.trim();
  if (!text || getActiveRun()) return;

  const agent = useAgentStore.getState();
  const runId = crypto.randomUUID();
  // Memory of this session, read before `beginRun` moves the previous run into the transcript.
  const history = buildHistoryBlock(sessionTurns(agent));
  // A manual skill choice applies to this run only; the next one goes back to auto.
  const skillId = agent.selectedSkillId;
  if (skillId !== undefined) agent.setSelectedSkill(undefined);
  const styleId = agent.selectedStyleId;
  if (styleId !== undefined) agent.setSelectedStyle(undefined);
  setRunStyleId(styleId);
  // Images from the composer move into this run; the composer starts empty again.
  const attachments = agent.pendingAttachments;
  if (attachments.length > 0) agent.clearAttachments();

  if (agent.backend === "local") {
    await startLocalAgentRun(runId, text, undefined, skillId, { attachments, history });
    return;
  }

  if (agent.backend === "custom") {
    await startCustomRun(runId, text, skillId, undefined, attachments, history);
    return;
  }

  agent.beginRun(runId, text);
  agent.set({ runLabel: "Anthropic API" });
  agent.appendLog(userLogEntry(text, attachments));
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
  const host = createToolHost({ onTransaction: setRunTail, attachments });
  setActiveRun({ id: runId, backend: "api", controller, host });
  try {
    await runApiAgent(text, {
      client: createAnthropicClient(apiKey),
      host,
      signal: controller.signal,
      skillId,
      attachments,
      history,
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
  const text = choice.trim();
  if (!text) return;
  // `text` (a picked option or a free-form answer) is what the ask_user tool result hands back.
  if (!answerPendingDecision(decisionId, text)) return;
  useAgentStore.getState().appendLog({ kind: "user", text: `→ ${text}` });
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
