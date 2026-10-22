import type { LocalAgentId, LocalAgentInfo, StepStatus } from "@pego/agent";
import type { RunStatus, RunStep } from "@/agent/use-agent-store";

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

/** "512 B", "48 KB", "1.2 MB". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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

export const API_BACKEND_LABEL = "API key (Anthropic)";

export type AgentStatusTone = "ready" | "warn" | "off";

export type AgentStatus = {
  tone: AgentStatusTone;
  /** Short status, e.g. "v1.2.3", "Not installed", "Bridge not running". */
  label: string;
  /** Selectable as the active agent. */
  selectable: boolean;
};

/** How to get an agent CLI (shown for agents that are not installed). */
export const INSTALL_HINTS: Record<LocalAgentId, string> = {
  "claude-code": "npm i -g @anthropic-ai/claude-code",
  codex: "npm i -g @openai/codex",
  opencode: "npm i -g opencode-ai",
  qwen: "npm i -g @qwen-code/qwen-code",
  gemini: "npm i -g @google/gemini-cli",
  cursor: "curl https://cursor.com/install -fsS | bash",
};

/** Status of one local agent. `info` is undefined while the bridge has not reported it. */
export const agentStatus = (
  info: LocalAgentInfo | undefined,
  bridgeConnected: boolean,
): AgentStatus => {
  if (!bridgeConnected || !info) {
    return { tone: "off", label: "Bridge not running", selectable: true };
  }
  if (!info.installed) return { tone: "off", label: "Not installed", selectable: false };
  const version = info.version ? `v${info.version.replace(/^v/, "")}` : "Installed";
  return { tone: info.note ? "warn" : "ready", label: version, selectable: true };
};

/** Second line of a picker row: the install hint, or the agent's note (e.g. login needed). */
export const agentDetail = (
  id: LocalAgentId,
  info: LocalAgentInfo | undefined,
  bridgeConnected: boolean,
): string | null => {
  if (!bridgeConnected || !info) return null;
  if (!info.installed) return info.note ?? `Install: ${INSTALL_HINTS[id]}`;
  return info.note ?? null;
};

/** Models whose id contains every whitespace-separated term of `query` (case-insensitive). */
export const filterModels = (models: readonly string[], query: string): string[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...models];
  return models.filter((model) => {
    const id = model.toLowerCase();
    return terms.every((term) => id.includes(term));
  });
};

/** The typed text as a custom model id, unless it is empty or already in the list. */
export const customModelCandidate = (models: readonly string[], query: string): string | null => {
  const value = query.trim();
  return value && !models.includes(value) ? value : null;
};

export const MODEL_DEFAULT_LABEL = "Default";

export type PillModel = { label: string; isDefault: boolean };

/** Composer pill model text: the chosen model id, or a muted "Default" when none is chosen. */
export const pillModel = (model: string | null | undefined): PillModel => {
  const id = model?.trim();
  return !id || id.toLowerCase() === "default"
    ? { label: MODEL_DEFAULT_LABEL, isDefault: true }
    : { label: id, isDefault: false };
};

/** Tooltip and accessible-name text for the pill: "Agent · model". */
export const pillTitle = (agentName: string, model: PillModel): string =>
  `${agentName} · ${model.label}`;

export const EXAMPLE_PROMPTS = [
  "Design a login screen with email, password and a primary button",
  "Make the selected frame a mobile pricing card with three tiers",
  "Tidy up spacing and alignment across the selected layers",
] as const;

export const BRIDGE_COMMAND = "bun run bridge";
export const MCP_ADD_COMMAND = "claude mcp add --transport http pego http://127.0.0.1:4519/mcp";

export type ProviderId = "anthropic" | "openai" | "opencode" | "qwen" | "gemini" | "cursor";

/** Whose logo represents each local agent CLI. */
export const AGENT_PROVIDER: Record<LocalAgentId, ProviderId> = {
  "claude-code": "anthropic",
  codex: "openai",
  opencode: "opencode",
  qwen: "qwen",
  gemini: "gemini",
  cursor: "cursor",
};

/** The first backtick-quoted command in an agent note (e.g. "Run `codex login` once"). */
export const noteCommand = (note: string | undefined): string | null =>
  note?.match(/`([^`]+)`/)?.[1]?.trim() || null;
