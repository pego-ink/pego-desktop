import type { StepStatus } from "@pego/agent";
import type { AgentBackend, RunStatus, RunStep } from "@/agent/use-agent-store";

export type StepIconKind = "pending" | "running" | "done" | "failed" | "skipped";

export const stepIconKind = (status: StepStatus): StepIconKind => status;

export const STEP_ICON_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export const isRunActive = (status: RunStatus): boolean =>
  status === "planning" || status === "running" || status === "awaiting_decision";

export const isRunFinished = (status: RunStatus): boolean =>
  status === "done" || status === "failed" || status === "cancelled";

export const formatCost = (usd: number): string => `$${usd.toFixed(2)}`;

export const formatTokens = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 100_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

export const formatUsage = (usage: {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): string =>
  `${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out · ${formatCost(usage.costUsd)}`;

/** Index (1-based) of the step currently in progress, falling back to the first unfinished one. */
export const currentStepNumber = (steps: readonly RunStep[]): number => {
  const running = steps.findIndex((s) => s.status === "running");
  if (running >= 0) return running + 1;
  const pending = steps.findIndex((s) => s.status === "pending");
  return pending >= 0 ? pending + 1 : steps.length;
};

export const runStatusLabel = (status: RunStatus, steps: readonly RunStep[]): string => {
  switch (status) {
    case "idle":
      return "Ready";
    case "planning":
      return "Planning…";
    case "running":
      return steps.length > 0
        ? `Working on step ${currentStepNumber(steps)} of ${steps.length}`
        : "Working…";
    case "awaiting_decision":
      return "Waiting for your decision";
    case "done":
      return "Finished";
    case "failed":
      return "Run failed";
    case "cancelled":
      return "Cancelled";
  }
};

export const countDoneSteps = (steps: readonly RunStep[]): number =>
  steps.filter((s) => s.status === "done").length;

export const selectionHint = (count: number): string | null =>
  count === 0 ? null : `${count} ${count === 1 ? "layer" : "layers"} selected`;

export const backendLabel = (backend: AgentBackend): string =>
  backend === "api" ? "API key" : "Claude Code (local)";

export const EXAMPLE_PROMPTS = [
  "Design a login screen with email, password and a primary button",
  "Make the selected frame a mobile pricing card with three tiers",
  "Tidy up spacing and alignment across the selected layers",
] as const;

export const BRIDGE_COMMAND = "bun run bridge";
export const MCP_ADD_COMMAND = "claude mcp add --transport http pego http://127.0.0.1:4519/mcp";
