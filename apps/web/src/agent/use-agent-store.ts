import { create } from "zustand";
import type { DecisionRequest, PlanStep, StepStatus } from "@pego/agent";

/** Which engine runs the panel's agent. `claude-code` goes through the local bridge. */
export type AgentBackend = "api" | "claude-code";

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
  /** Another Pego tab or window is the one connected; this one waits until the user takes over. */
  replaced: boolean;
};

type AgentState = {
  backend: AgentBackend;
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
};

let logSeq = 0;

export const useAgentStore = create<AgentState & AgentActions>((set) => ({
  ...idleRun,
  backend: "api",
  bridge: { connected: false, claudeCodeAvailable: false, mcpUrl: null, replaced: false },

  set: (patch) => set(patch),
  setBackend: (backend) => set({ backend }),
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
}));
