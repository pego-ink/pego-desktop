import { create } from "zustand";
import {
  RUN_ATTACHMENT_LIMITS,
  type DecisionRequest,
  type LocalAgentId,
  type LocalAgentInfo,
  type PlanStep,
  type RunAttachment,
  type StepStatus,
} from "@pego/agent";
import { nextAttachmentId } from "@/agent/attachments";
import {
  emptySession,
  sessionTitle,
  settleStatus,
  type AttachmentMeta,
  type QueuedMessage,
  type SessionState,
  type SessionTurn,
} from "@/agent/sessions/session-model";
import { pickColorIndex } from "@/agent/run-colors";
import { isRunActive } from "@/panels/agent/agent-format";
import {
  loadAgentPrefs,
  saveAgentPrefs,
  type AgentBackend,
  type AgentPrefs,
} from "@/agent/agent-prefs";

export type { AgentBackend, QueuedMessage };

export type RunStatus =
  "idle" | "planning" | "running" | "awaiting_decision" | "done" | "failed" | "cancelled";

export type RunStep = PlanStep & { status: StepStatus; summary?: string };

export type PendingDecision = DecisionRequest & { id: string };

export type AgentLogEntry = {
  id: string;
  at: number;
  kind: "user" | "assistant" | "tool" | "info" | "error";
  text: string;
  tool?: { name: string; isError: boolean };
  /** Images the user attached (user entries only). */
  attachments?: RunAttachment[];
  /** Name and size of images attached in a restored session (the image data is not stored). */
  attachmentsMeta?: AttachmentMeta[];
  /**
   * A message sent into the running agent (steer), user entries only: "pending" until the agent
   * took it, "delivered" once it did, "failed" when the run ended first.
   */
  steered?: "pending" | "delivered" | "failed";
};

export type BridgeStatus = {
  connected: boolean;
  /** The bridge found a usable local Claude Code login for Agent SDK runs. */
  claudeCodeAvailable: boolean;
  mcpUrl: string | null;
  /** Local agent CLIs the bridge detected (empty until `welcome`). */
  agents: LocalAgentInfo[];
};

/** Cached model list for one local agent (`models_request` / `models`). */
export type ModelsEntry = {
  models: string[];
  loading: boolean;
  /** True once a `models` reply arrived (even an empty or failed one). */
  loaded: boolean;
  error?: string;
};

export const emptyBridge = (): BridgeStatus => ({
  connected: false,
  claudeCodeAvailable: false,
  mcpUrl: null,
  agents: [],
});

/** One run's live fields: the latest turn of a session (the earlier ones are in `turns`). */
export type RunFields = {
  /** Who runs the current/last run, e.g. "Codex · gpt-5" (shown in the run header). */
  runLabel: string | null;
  status: RunStatus;
  runId: string | null;
  prompt: string;
  steps: RunStep[];
  decision: PendingDecision | null;
  log: AgentLogEntry[];
  /** Nodes the agent is touching right now (ghost outline on canvas). */
  focusIds: string[];
  /** History transactions created by the current/last run (shown as "N changes"). */
  transactionCount: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
};

/**
 * A chat session held in memory: its finished turns plus the live fields of its latest run. The
 * visible session is always live; others stay live while they run in the background (or have
 * queued messages, or finished in the background and were not looked at yet).
 */
export type SessionLive = SessionState &
  RunFields & {
    /** Palette slot of this session's canvas focus box and cursor (see agent/run-colors). */
    colorIndex: number;
    /** Messages for the next run of this session, oldest first (see agent/queue). */
    queue: QueuedMessage[];
  };

type AgentState = {
  backend: AgentBackend;
  /** Local agent used when `backend` is "local". */
  localAgentId: LocalAgentId;
  /** Selected model per local agent; undefined = the CLI's default. */
  modelByAgent: Partial<Record<LocalAgentId, string>>;
  /** Custom provider used when `backend` is "custom" (see agent/providers). */
  customProviderId: string | null;
  /** The user picked the backend/agent; until then a ready local agent is chosen automatically. */
  explicit: boolean;
  modelsByAgent: Partial<Record<LocalAgentId, ModelsEntry>>;
  /** An `agents_refresh` is in flight. */
  agentsRefreshing: boolean;
  /**
   * Skill for the next run only: undefined = auto-detect from the prompt, null = none (core
   * only), string = that skill id. Cleared when a run starts; never persisted.
   */
  selectedSkillId: string | null | undefined;
  /** Same for the style skill (Bauhaus, Swiss…): undefined = auto, null = no style. */
  selectedStyleId: string | null | undefined;
  /** Images attached in the composer for the next run; moved into the run on send. Never persisted. */
  pendingAttachments: RunAttachment[];
  /** Chat sessions in memory by id (see `SessionLive`). Always holds `visibleSessionId`. */
  liveSessions: Record<string, SessionLive>;
  /** Session shown in the Agent panel. */
  visibleSessionId: string;
  bridge: BridgeStatus;
};

type LogInput = Omit<AgentLogEntry, "id" | "at">;
type UsageInput = { inputTokens: number; outputTokens: number; costUsd?: number };
type SessionPatch = Partial<SessionLive> | ((live: SessionLive) => Partial<SessionLive>);

type AgentActions = {
  set: (patch: Partial<AgentState>) => void;
  setBackend: (backend: AgentBackend) => void;
  setLocalAgent: (agentId: LocalAgentId) => void;
  /** Select a custom provider: sets backend "custom" and remembers the id. */
  setCustomProvider: (providerId: string) => void;
  /** The selected custom provider no longer exists: fall back to `backend`. */
  clearCustomProvider: (backend: Exclude<AgentBackend, "custom">) => void;
  setSelectedSkill: (skillId: string | null | undefined) => void;
  setSelectedStyle: (styleId: string | null | undefined) => void;
  /** Attach an image to the next run (id assigned here). False when the count limit is reached. */
  addAttachment: (attachment: Omit<RunAttachment, "id">) => boolean;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  /** Select a model for an agent; undefined/empty restores the CLI default. */
  setModel: (agentId: LocalAgentId, model: string | undefined) => void;
  /** Re-read persisted preferences (done once at store creation). */
  restorePrefs: () => void;
  /**
   * Show a session in the panel. One that is already live (running in the background) keeps its
   * live state. The previously visible session leaves memory unless it is still needed there.
   */
  showSession: (session: SessionState) => void;
  /** Put a session in memory without showing it (no-op when it is already live). */
  addSession: (session: SessionState) => void;
  /** Only `session` stays in memory, shown in the panel (another file was opened). */
  resetSessions: (session: SessionState) => void;
  /** Forget a live session (it was deleted). The visible session is never dropped. */
  dropSession: (sessionId: string) => void;
  setSessionTitle: (sessionId: string, title: string | null) => void;
  /**
   * Start a new run in a session: its previous run becomes a turn and the run fields reset. The
   * session gets a palette slot no other running session uses.
   */
  beginRun: (sessionId: string, runId: string, prompt: string) => void;
  /** Merge fields into a live session (no-op for an unknown id). */
  patchSession: (sessionId: string, patch: SessionPatch) => void;
  setPlan: (sessionId: string, steps: PlanStep[]) => void;
  setStepStatus: (sessionId: string, stepId: string, status: StepStatus, summary?: string) => void;
  /** Append a log entry; returns its id. */
  appendLog: (sessionId: string, entry: LogInput) => string;
  /** Set the delivery state of a steered user entry. */
  setSteered: (
    sessionId: string,
    entryId: string,
    steered: "pending" | "delivered" | "failed",
  ) => void;
  /** The agent took a steered message: the oldest pending entry with this text becomes delivered. */
  markSteerDelivered: (sessionId: string, text: string) => void;
  /** Every still-pending steered entry of the session did not arrive (the run ended). */
  failPendingSteers: (sessionId: string) => void;
  addUsage: (sessionId: string, usage: UsageInput) => void;
};

const idleRun: RunFields = {
  status: "idle",
  runId: null,
  prompt: "",
  steps: [],
  decision: null,
  log: [],
  focusIds: [],
  transactionCount: 0,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  runLabel: null,
};

/** A session as it enters memory: no live run yet. */
export const liveFromSession = (session: SessionState, colorIndex = 0): SessionLive => ({
  ...session,
  ...idleRun,
  colorIndex,
  queue: session.queue ?? [],
});

/** The latest run as a turn, or null when nothing has run since the session was opened. */
export const currentTurn = (
  state: Pick<RunFields, "runId" | "status" | "runLabel" | "log" | "usage">,
): SessionTurn | null =>
  state.runId === null || state.log.length === 0
    ? null
    : {
        runId: state.runId,
        status: settleStatus(state.status),
        runLabel: state.runLabel,
        log: state.log,
        usage: state.usage,
      };

type TurnSource = Parameters<typeof currentTurn>[0] & Pick<SessionState, "turns">;

/** All turns of a live session, oldest first, including the latest run. */
export const sessionTurns = (state: TurnSource): SessionTurn[] => {
  const latest = currentTurn(state);
  return latest ? [...state.turns, latest] : state.turns;
};

/** A live session as plain data (for titles, storage and the prompt history). */
export const sessionOf = (
  state: TurnSource & Pick<SessionState, "id" | "createdAt" | "customTitle" | "queue">,
): SessionState => ({
  id: state.id,
  createdAt: state.createdAt,
  customTitle: state.customTitle,
  turns: sessionTurns(state),
  queue: state.queue,
});

/** Cheap title for selectors: avoids copying the whole transcript on every log entry. */
export const liveTitle = (live: TurnSource & Pick<SessionState, "customTitle">): string => {
  const latest = live.turns.length === 0 ? currentTurn(live) : null;
  return sessionTitle({ customTitle: live.customTitle, turns: latest ? [latest] : live.turns });
};

/** The session shown in the panel. */
export const visibleSession = (state: Pick<AgentState, "liveSessions" | "visibleSessionId">) =>
  state.liveSessions[state.visibleSessionId]!;

/** The live session whose latest run is `runId`. */
export const findRunSession = (
  state: Pick<AgentState, "liveSessions">,
  runId: string,
): SessionLive | undefined =>
  Object.values(state.liveSessions).find((live) => live.runId === runId);

/** Sessions whose run is working right now. */
export const runningSessions = (state: Pick<AgentState, "liveSessions">): SessionLive[] =>
  Object.values(state.liveSessions).filter((live) => isRunActive(live.status));

/** How many runs are working right now (any session). */
export const selectRunsActive = (state: Pick<AgentState, "liveSessions">): number =>
  runningSessions(state).length;

/** A session stays in memory while hidden only when something still happens or waits in it. */
const keepsLiveWhenHidden = (live: SessionLive): boolean =>
  isRunActive(live.status) || live.queue.length > 0;

const initialSession = emptySession();

const prefsOf = (state: AgentPrefs): AgentPrefs => ({
  backend: state.backend,
  localAgentId: state.localAgentId,
  modelByAgent: state.modelByAgent,
  customProviderId: state.customProviderId,
  explicit: state.explicit,
});

let logSeq = 0;

export type AgentStoreState = AgentState & AgentActions;

const createAgentStore = () =>
  create<AgentState & AgentActions>((set, get) => {
    const persist = () => saveAgentPrefs(prefsOf(get()));
    const patch = (sessionId: string, update: SessionPatch) =>
      set((state) => {
        const live = state.liveSessions[sessionId];
        if (!live) return state;
        const changes = typeof update === "function" ? update(live) : update;
        return { liveSessions: { ...state.liveSessions, [sessionId]: { ...live, ...changes } } };
      });
    return {
      liveSessions: { [initialSession.id]: liveFromSession(initialSession) },
      visibleSessionId: initialSession.id,
      ...loadAgentPrefs(),
      modelsByAgent: {},
      agentsRefreshing: false,
      bridge: emptyBridge(),
      selectedSkillId: undefined,
      selectedStyleId: undefined,
      pendingAttachments: [],

      set: (next) => set(next),
      setBackend: (backend) => {
        set({ backend, explicit: true });
        persist();
      },
      setSelectedSkill: (selectedSkillId) => set({ selectedSkillId }),
      setSelectedStyle: (selectedStyleId) => set({ selectedStyleId }),
      addAttachment: (attachment) => {
        const current = get().pendingAttachments;
        if (current.length >= RUN_ATTACHMENT_LIMITS.maxCount) return false;
        set({
          pendingAttachments: [...current, { ...attachment, id: nextAttachmentId(current) }],
        });
        return true;
      },
      removeAttachment: (id) =>
        set((state) => ({
          pendingAttachments: state.pendingAttachments.filter((item) => item.id !== id),
        })),
      clearAttachments: () => set({ pendingAttachments: [] }),
      setLocalAgent: (localAgentId) => {
        set({ localAgentId, explicit: true });
        persist();
      },
      setCustomProvider: (customProviderId) => {
        set({ backend: "custom", customProviderId, explicit: true });
        persist();
      },
      clearCustomProvider: (backend) => {
        set({ backend, customProviderId: null });
        persist();
      },
      setModel: (agentId, model) => {
        const next = { ...get().modelByAgent };
        const value = model?.trim();
        if (value) next[agentId] = value;
        else delete next[agentId];
        set({ modelByAgent: next });
        persist();
      },
      restorePrefs: () => set(loadAgentPrefs()),
      showSession: (session) =>
        set((state) => {
          const liveSessions = { ...state.liveSessions };
          const previous = liveSessions[state.visibleSessionId];
          if (previous && previous.id !== session.id && !keepsLiveWhenHidden(previous)) {
            delete liveSessions[previous.id];
          }
          liveSessions[session.id] ??= liveFromSession(session);
          return { liveSessions, visibleSessionId: session.id };
        }),
      addSession: (session) =>
        set((state) =>
          state.liveSessions[session.id]
            ? state
            : { liveSessions: { ...state.liveSessions, [session.id]: liveFromSession(session) } },
        ),
      resetSessions: (session) =>
        set({
          liveSessions: { [session.id]: liveFromSession(session) },
          visibleSessionId: session.id,
        }),
      dropSession: (sessionId) =>
        set((state) => {
          if (sessionId === state.visibleSessionId || !state.liveSessions[sessionId]) return state;
          const liveSessions = { ...state.liveSessions };
          delete liveSessions[sessionId];
          return { liveSessions };
        }),
      setSessionTitle: (sessionId, customTitle) => patch(sessionId, { customTitle }),
      beginRun: (sessionId, runId, prompt) => {
        const used = runningSessions(get())
          .filter((live) => live.id !== sessionId)
          .map((live) => live.colorIndex);
        patch(sessionId, (live) => {
          const previous = currentTurn(live);
          return {
            ...idleRun,
            turns: previous ? [...live.turns, previous] : live.turns,
            runId,
            prompt,
            status: "planning",
            colorIndex: pickColorIndex(used),
          };
        });
      },
      patchSession: patch,
      setPlan: (sessionId, steps) =>
        patch(sessionId, { steps: steps.map((step) => ({ ...step, status: "pending" })) }),
      setStepStatus: (sessionId, stepId, status, summary) =>
        patch(sessionId, (live) => ({
          steps: live.steps.map((step) =>
            step.id === stepId ? { ...step, status, summary: summary ?? step.summary } : step,
          ),
        })),
      appendLog: (sessionId, entry) => {
        const id = `log-${++logSeq}`;
        patch(sessionId, (live) => ({ log: [...live.log, { ...entry, id, at: Date.now() }] }));
        return id;
      },
      setSteered: (sessionId, entryId, steered) =>
        patch(sessionId, (live) => ({
          log: live.log.map((entry) => (entry.id === entryId ? { ...entry, steered } : entry)),
        })),
      markSteerDelivered: (sessionId, text) =>
        patch(sessionId, (live) => {
          const pending = live.log.filter((e) => e.steered === "pending");
          const target = pending.find((e) => e.text === text) ?? pending[0];
          if (!target) return {};
          return {
            log: live.log.map((e) => (e === target ? { ...e, steered: "delivered" as const } : e)),
          };
        }),
      failPendingSteers: (sessionId) =>
        patch(sessionId, (live) =>
          live.log.some((e) => e.steered === "pending")
            ? {
                log: live.log.map((e) =>
                  e.steered === "pending" ? { ...e, steered: "failed" as const } : e,
                ),
              }
            : {},
        ),
      addUsage: (sessionId, usage) =>
        patch(sessionId, (live) => ({
          usage: {
            inputTokens: live.usage.inputTokens + usage.inputTokens,
            outputTokens: live.usage.outputTokens + usage.outputTokens,
            costUsd: live.usage.costUsd + (usage.costUsd ?? 0),
          },
        })),
    };
  });

/**
 * Dev hot reload re-runs this module; keep the same store instance so the live bridge
 * connection (which writes into it) and the panel never drift apart.
 */
export const useAgentStore: ReturnType<typeof createAgentStore> =
  (import.meta.hot?.data.agentStore as ReturnType<typeof createAgentStore> | undefined) ??
  createAgentStore();

if (import.meta.hot) {
  import.meta.hot.data.agentStore = useAgentStore;
}

/** Read the visible session's live state in a component (selectors must return stable values). */
export const useVisibleRun = <T>(selector: (live: SessionLive) => T): T =>
  useAgentStore((state) => selector(visibleSession(state)));

/**
 * Writes of one run (or, with `runId` null, of whichever session is visible: Claude Code over
 * MCP, tests). Each call resolves the run's session afresh, so a run whose session was dropped
 * writes nowhere instead of into another chat.
 */
export type RunScope = {
  readonly runId: string | null;
  sessionId: () => string | null;
  get: () => SessionLive | null;
  set: (patch: Partial<RunFields>) => void;
  appendLog: (entry: LogInput) => void;
  setPlan: (steps: PlanStep[]) => void;
  setStepStatus: (stepId: string, status: StepStatus, summary?: string) => void;
  addUsage: (usage: UsageInput) => void;
};

export const runScope = (runId: string | null): RunScope => {
  const sessionId = (): string | null => {
    const state = useAgentStore.getState();
    if (runId === null) return state.visibleSessionId;
    return findRunSession(state, runId)?.id ?? null;
  };
  const withSession = (write: (id: string) => void) => {
    const id = sessionId();
    if (id !== null) write(id);
  };
  const store = () => useAgentStore.getState();
  return {
    runId,
    sessionId,
    get: () => {
      const id = sessionId();
      return id === null ? null : (store().liveSessions[id] ?? null);
    },
    set: (patch) => withSession((id) => store().patchSession(id, patch)),
    appendLog: (entry) => withSession((id) => store().appendLog(id, entry)),
    setPlan: (steps) => withSession((id) => store().setPlan(id, steps)),
    setStepStatus: (stepId, status, summary) =>
      withSession((id) => store().setStepStatus(id, stepId, status, summary)),
    addUsage: (usage) => withSession((id) => store().addUsage(id, usage)),
  };
};
