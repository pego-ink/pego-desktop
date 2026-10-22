import { create } from "zustand";
import type {
  DecisionRequest,
  LocalAgentId,
  LocalAgentInfo,
  PlanStep,
  StepStatus,
} from "@pego/agent";
import {
  loadAgentPrefs,
  saveAgentPrefs,
  type AgentBackend,
  type AgentPrefs,
} from "@/agent/agent-prefs";

export type { AgentBackend };

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

type AgentState = {
  backend: AgentBackend;
  /** Local agent used when `backend` is "local". */
  localAgentId: LocalAgentId;
  /** Selected model per local agent; undefined = the CLI's default. */
  modelByAgent: Partial<Record<LocalAgentId, string>>;
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
  /** History transactions created by the current/last run, oldest first (for "Undo all"). */
  transactionCount: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  bridge: BridgeStatus;
};

type AgentActions = {
  set: (patch: Partial<AgentState>) => void;
  setBackend: (backend: AgentBackend) => void;
  setLocalAgent: (agentId: LocalAgentId) => void;
  setSelectedSkill: (skillId: string | null | undefined) => void;
  /** Select a model for an agent; undefined/empty restores the CLI default. */
  setModel: (agentId: LocalAgentId, model: string | undefined) => void;
  /** Re-read persisted preferences (done once at store creation). */
  restorePrefs: () => void;
  /** Reset run fields for a new run (keeps backend and bridge status). */
  beginRun: (runId: string, prompt: string) => void;
  setPlan: (steps: PlanStep[]) => void;
  setStepStatus: (stepId: string, status: StepStatus, summary?: string) => void;
  appendLog: (entry: Omit<AgentLogEntry, "id" | "at">) => void;
  addUsage: (usage: { inputTokens: number; outputTokens: number; costUsd?: number }) => void;
};

const idleRun = {
  status: "idle" as RunStatus,
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

const prefsOf = (state: AgentPrefs): AgentPrefs => ({
  backend: state.backend,
  localAgentId: state.localAgentId,
  modelByAgent: state.modelByAgent,
  explicit: state.explicit,
});

let logSeq = 0;

const createAgentStore = () =>
  create<AgentState & AgentActions>((set, get) => {
    const persist = () => saveAgentPrefs(prefsOf(get()));
    return {
      ...idleRun,
      ...loadAgentPrefs(),
      modelsByAgent: {},
      agentsRefreshing: false,
      bridge: emptyBridge(),
      selectedSkillId: undefined,

      set: (patch) => set(patch),
      setBackend: (backend) => {
        set({ backend, explicit: true });
        persist();
      },
      setSelectedSkill: (selectedSkillId) => set({ selectedSkillId }),
      setLocalAgent: (localAgentId) => {
        set({ localAgentId, explicit: true });
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
      beginRun: (runId, prompt) => set({ ...idleRun, runId, prompt, status: "planning" }),
      setPlan: (steps) => set({ steps: steps.map((step) => ({ ...step, status: "pending" })) }),
      setStepStatus: (stepId, status, summary) =>
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === stepId ? { ...step, status, summary: summary ?? step.summary } : step,
          ),
        })),
      appendLog: (entry) =>
        set((state) => ({
          log: [...state.log, { ...entry, id: `log-${++logSeq}`, at: Date.now() }],
        })),
      addUsage: (usage) =>
        set((state) => ({
          usage: {
            inputTokens: state.usage.inputTokens + usage.inputTokens,
            outputTokens: state.usage.outputTokens + usage.outputTokens,
            costUsd: state.usage.costUsd + (usage.costUsd ?? 0),
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
