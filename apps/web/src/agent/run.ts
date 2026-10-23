import type { PromptPart, RunAttachment } from "@pego/agent";
import { useDocumentStore } from "@/store/use-document-store";
import { canUndoRunIn, runTargetFor, undoRunIn } from "@/workspace/document-target";
import { setWorkspaceRunCanceller } from "@/workspace/use-workspace-store";
import { loadApiKey } from "./api-key";
import { createAnthropicClient, createCompatClient, runApiAgent } from "./api-runtime";
import { answerPendingDecision, cancelPendingDecisions, pendingDecisionScope } from "./decisions";
import { cancelLocalAgentRun, startLocalAgentRun } from "./local-agent-run";
import { isLocalBaseUrl } from "./provider-url";
import { listCustomProviders, loadProviderKey } from "./providers/store";
import { runOpenAiCompatibleAgent } from "./providers/openai-runtime";
import {
  allRuns,
  getRun,
  registerRun,
  startBlock,
  unregisterRun,
  type StartBlock,
} from "./run-registry";
import { forgetSessionHome, sessionHome } from "./sessions/session-home";
import { buildHistoryBlock } from "./sessions/session-context";
import { createSteerInbox } from "./steer-inbox";
import { createToolHost } from "./tool-host";
import { findRunSession, sessionTurns, useAgentStore } from "./use-agent-store";

/**
 * Agent run entry points used by the agent panel. Dispatches on `useAgentStore().backend`:
 * "api" runs the in-browser Anthropic loop with the user's own key, "local" hands the
 * run to the local bridge (any supported coding-agent CLI), "custom" runs a user-added
 * OpenAI- or Anthropic-compatible provider in the browser. One run per chat session, up to
 * `MAX_CONCURRENT_RUNS` at once (see run-registry).
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

/** Per-run inputs shared by every backend. */
export type RunStartOptions = {
  /** Chat session the run belongs to; defaults to the visible one. */
  sessionId?: string;
  /** Explicit style for this run: undefined = auto-detect from the prompt, null = none. */
  styleId?: string | null;
  attachments?: readonly RunAttachment[];
  /** Session memory block (see sessions/session-context); the log keeps only the user's text. */
  history?: string;
  /** The prompt is a steer that restarted the run: its bubble carries the "Steered" label. */
  steered?: boolean;
  /** What the user bubble and the session title show; `text` (with extra context) goes to the agent. */
  displayText?: string;
  /** The prompt with its mention chips, for the user bubble. */
  parts?: readonly PromptPart[];
  /** Design skill picked by a mention; wins over the skill chip for this run. */
  skillId?: string;
};

const shownText = (text: string, options: RunStartOptions): string =>
  options.displayText?.trim() || text;

const sessionFor = (options: RunStartOptions): string =>
  options.sessionId ?? useAgentStore.getState().visibleSessionId;

/** The user bubble of the activity log (carries the attached images and chips, if any). */
export const userLogEntry = (
  text: string,
  attachments: readonly RunAttachment[],
  steered = false,
  parts?: readonly PromptPart[],
) => ({
  kind: "user" as const,
  text,
  ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
  ...(steered ? { steered: "delivered" as const } : {}),
  ...(parts?.some((part) => part.kind === "mention") ? { parts: [...parts] } : {}),
});

/**
 * Registry pieces of an in-browser run: a mailbox for steers (its bubbles flip to "delivered" when
 * a turn takes them) and the image list the tool host reads, which steer images are added to.
 */
const inBrowserSteering = (sessionId: string, attachments: readonly RunAttachment[]) => {
  const steerAttachments = [...attachments];
  const steerInbox = createSteerInbox((message) =>
    useAgentStore.getState().setSteered(sessionId, message.id, "delivered"),
  );
  return { steerInbox, attachments: steerAttachments };
};

/**
 * A run ended with steer messages the model never read: say so on their bubbles and put their text
 * back at the front of the session's queue so the next run (or the user) still gets them.
 */
const settleSteers = (sessionId: string, steerInbox: ReturnType<typeof createSteerInbox>) => {
  const left = steerInbox.takePending();
  if (left.length === 0) return;
  const agent = useAgentStore.getState();
  for (const message of left) agent.setSteered(sessionId, message.id, "failed");
  agent.patchSession(sessionId, (live) => ({
    queue: [
      ...left.map((message) => ({
        id: crypto.randomUUID(),
        text: message.text,
        attachments: message.attachments,
        createdAt: Date.now(),
      })),
      ...live.queue,
    ],
  }));
};

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
  options: RunStartOptions = {},
): Promise<void> => {
  const { attachments = [], history = "", styleId } = options;
  const sessionId = sessionFor(options);
  const agent = useAgentStore.getState();
  agent.beginRun(sessionId, runId, shownText(text, options));
  const controller = new AbortController();
  const steering = inBrowserSteering(sessionId, attachments);
  const host = createToolHost({
    runId,
    attachments: steering.attachments,
    target: runTargetFor(sessionId),
  });
  const scope = host.run;
  scope.set({ runLabel: "Custom provider" });
  scope.appendLog(
    userLogEntry(shownText(text, options), attachments, options.steered, options.parts),
  );
  registerRun({ id: runId, sessionId, backend: "custom", controller, host, styleId, ...steering });

  const fail = (message: string) => {
    scope.appendLog({ kind: "error", text: message });
    scope.set({ status: "failed" });
  };

  try {
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
    scope.set({ runLabel: `${provider.name} · ${provider.executorModel}` });

    if (provider.kind === "openai-compatible") {
      await deps.runOpenAi(text, {
        provider,
        apiKey: key,
        host,
        signal: controller.signal,
        skillId,
        styleId,
        attachments,
        history,
        steer: steering.steerInbox,
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
        styleId,
        attachments,
        history,
        steer: steering.steerInbox,
      });
    }
  } finally {
    unregisterRun(runId);
    settleSteers(sessionId, steering.steerInbox);
  }
};

/**
 * A run that may not start shows why in its session: a busy chat gets an error line in its
 * current run; otherwise the prompt becomes a failed turn so the user sees what was refused.
 */
const showStartBlock = (sessionId: string, text: string, block: StartBlock) => {
  const agent = useAgentStore.getState();
  if (block.reason === "session_busy") {
    agent.appendLog(sessionId, { kind: "error", text: block.message });
    return;
  }
  agent.beginRun(sessionId, crypto.randomUUID(), text);
  agent.appendLog(sessionId, { kind: "user", text });
  agent.appendLog(sessionId, { kind: "error", text: block.message });
  agent.patchSession(sessionId, { status: "failed" });
};

/**
 * Start a run in a chat session (default: the visible one). Resolves when the run ended (API and
 * custom backends) or was handed to the bridge (local), with its id; null when nothing started.
 * `attachments` overrides the composer's pending images (e.g. for a queued message).
 */
export const startRun = async (
  prompt: string,
  options: Pick<
    RunStartOptions,
    "sessionId" | "attachments" | "steered" | "displayText" | "parts" | "skillId" | "styleId"
  > = {},
): Promise<string | null> => {
  const text = prompt.trim();
  if (!text) return null;

  const agent = useAgentStore.getState();
  const sessionId = sessionFor(options);
  const live = agent.liveSessions[sessionId];
  if (!live) return null;
  const block = startBlock(allRuns(), sessionId);
  if (block) {
    showStartBlock(sessionId, shownText(text, options), block);
    return null;
  }

  const runId = crypto.randomUUID();
  // Memory of this session, read before `beginRun` moves the previous run into the transcript.
  const history = buildHistoryBlock(sessionTurns(live));
  // A manual skill choice (chip or mention) applies to this run only; the next one is auto.
  const skillId = options.skillId ?? agent.selectedSkillId;
  if (agent.selectedSkillId !== undefined) agent.setSelectedSkill(undefined);
  const styleId = options.styleId ?? agent.selectedStyleId;
  if (agent.selectedStyleId !== undefined) agent.setSelectedStyle(undefined);
  // Images from the composer move into this run; the composer starts empty again.
  const attachments = options.attachments ?? agent.pendingAttachments;
  if (!options.attachments && attachments.length > 0) agent.clearAttachments();
  const start: RunStartOptions = {
    sessionId,
    styleId,
    attachments,
    history,
    steered: options.steered,
    displayText: options.displayText,
    parts: options.parts,
  };

  if (agent.backend === "local") {
    await startLocalAgentRun(runId, text, undefined, skillId, start);
    return runId;
  }

  if (agent.backend === "custom") {
    await startCustomRun(runId, text, skillId, undefined, start);
    return runId;
  }

  agent.beginRun(sessionId, runId, shownText(text, options));
  const controller = new AbortController();
  const steering = inBrowserSteering(sessionId, attachments);
  const host = createToolHost({
    runId,
    attachments: steering.attachments,
    target: runTargetFor(sessionId),
  });
  const scope = host.run;
  scope.set({ runLabel: "Anthropic API" });
  scope.appendLog(
    userLogEntry(shownText(text, options), attachments, options.steered, options.parts),
  );
  registerRun({ id: runId, sessionId, backend: "api", controller, host, styleId, ...steering });

  try {
    const apiKey = await loadApiKey();
    if (!apiKey) {
      scope.appendLog({
        kind: "error",
        text: "No Anthropic API key set. Add one in agent settings.",
      });
      scope.set({ status: "failed" });
      return runId;
    }
    await runApiAgent(text, {
      client: createAnthropicClient(apiKey),
      host,
      signal: controller.signal,
      skillId,
      styleId,
      attachments,
      history,
      steer: steering.steerInbox,
    });
  } finally {
    unregisterRun(runId);
    settleSteers(sessionId, steering.steerInbox);
  }
  return runId;
};

/** Stop one run. Its open decision cards close; other runs keep going. */
export const cancelRun = (runId: string): void => {
  const run = getRun(runId);
  if (!run) return;
  run.controller.abort();
  cancelPendingDecisions(runId);
  if (run.backend === "local") {
    cancelLocalAgentRun(runId);
    const scope = run.host.run;
    for (const step of scope.get()?.steps ?? []) {
      if (step.status === "pending" || step.status === "running") {
        scope.setStepStatus(step.id, "skipped");
      }
    }
    scope.set({ status: "cancelled", decision: null, focusIds: [] });
    const sessionId = scope.sessionId();
    if (sessionId) useAgentStore.getState().failPendingSteers(sessionId);
    unregisterRun(runId);
  }
  // API runs finish through `runApiAgent`, which sees the abort and sets "cancelled".
};

/** Stop every run. */
export const cancelAllRuns = (): void => {
  for (const run of allRuns()) cancelRun(run.id);
};

/**
 * A tab is being closed: stop the runs editing its document and forget its chat sessions (their
 * queued messages would otherwise start runs on a document that is gone). The session shown in the
 * panel stays until the editor shows another tab's chats; its queue is emptied.
 */
setWorkspaceRunCanceller((workspaceId) => {
  for (const run of allRuns()) {
    if (run.host.target?.workspaceId === workspaceId) cancelRun(run.id);
  }
  const agent = useAgentStore.getState();
  for (const id of Object.keys(agent.liveSessions)) {
    if (sessionHome(id)?.workspaceId !== workspaceId) continue;
    if (id === agent.visibleSessionId) {
      agent.patchSession(id, { queue: [] });
      continue;
    }
    agent.dropSession(id);
    forgetSessionHome(id);
  }
});

/** Answer a pending decision card; the answer is logged in the session of the run that asked. */
export const answerDecision = (decisionId: string, choice: string): void => {
  const text = choice.trim();
  if (!text) return;
  const scope = pendingDecisionScope(decisionId);
  // `text` (a picked option or a free-form answer) is what the ask_user tool result hands back.
  if (!scope || !answerPendingDecision(decisionId, text)) return;
  scope.appendLog({ kind: "user", text: `→ ${text}` });
};

/** The document a run edited (its session's tab), when that is known. */
const runTarget = (runId: string) => {
  const live = findRunSession(useAgentStore.getState(), runId);
  return live ? runTargetFor(live.id) : undefined;
};

/** Whether "Undo all" can revert this run right now, with the reason when it cannot. */
export const canUndoRunChanges = (runId: string): { ok: boolean; message?: string } => {
  const target = runTarget(runId);
  return target ? canUndoRunIn(target, runId) : useDocumentStore.getState().canUndoRun(runId);
};

/**
 * Revert only this run's changes as one new undo step (refused when someone else edited the same
 * layers since). The run's "N changes" bar goes away when it worked.
 */
export const undoRunChanges = (runId: string): { ok: boolean; message?: string } => {
  const target = runTarget(runId);
  const result = target ? undoRunIn(target, runId) : useDocumentStore.getState().undoRun(runId);
  if (!result.ok) return result;
  const live = findRunSession(useAgentStore.getState(), runId);
  if (live) useAgentStore.getState().patchSession(live.id, { transactionCount: 0, focusIds: [] });
  return result;
};
