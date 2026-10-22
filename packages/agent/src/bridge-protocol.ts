import type { DecisionRequest, PlanStep, StepStatus } from "./types";

/**
 * WebSocket protocol between the editor tab (client) and the local bridge (`apps/bridge`).
 * The bridge never touches the document: every tool call is executed by the editor through
 * the shared tool specs, so Claude Code (MCP or Agent SDK) and the in-browser agent edit the
 * document the same way.
 */
export const BRIDGE_DEFAULT_PORT = 4519;
export const BRIDGE_PROTOCOL_VERSION = 3;

/** Messages the editor sends to the bridge. */
export type EditorToBridge =
  | { type: "hello"; protocol: number; documentName: string }
  /** Result of a `tool_call` the bridge forwarded. */
  | {
      type: "tool_result";
      callId: string;
      content: string;
      isError: boolean;
      /** Base64 PNGs (e.g. get_screenshot); the bridge maps them to MCP image content. */
      images?: { mediaType: "image/png"; data: string; width: number; height: number }[];
    }
  /** This editor was focused or became visible; the bridge routes MCP tool calls to it. */
  | { type: "focus" }
  /** Start a run with a local agent CLI (the user's own login/config for that CLI). */
  | {
      type: "run_start";
      runId: string;
      prompt: string;
      agentId: LocalAgentId;
      model?: string;
      /** Images the user attached in the composer (reference material for the agent). */
      attachments?: RunAttachment[];
    }
  /** Re-detect installed agent CLIs; answered with `agents`. */
  | { type: "agents_refresh" }
  /** List models an agent can use; answered with `models`. */
  | { type: "models_request"; agentId: LocalAgentId }
  | { type: "run_cancel"; runId: string };

/** Messages the bridge sends to the editor. */
export type BridgeToEditor =
  | {
      type: "welcome";
      protocol: number;
      claudeCodeAvailable: boolean;
      mcpUrl: string;
      agents: LocalAgentInfo[];
    }
  | { type: "agents"; agents: LocalAgentInfo[] }
  | { type: "models"; agentId: LocalAgentId; models: string[]; error?: string }
  /** Execute a shared tool by name in the editor and answer with `tool_result`. */
  | {
      type: "tool_call";
      callId: string;
      tool: string;
      input: unknown;
      /** Who is calling: an Agent SDK run started from the panel, or Claude Code over MCP. */
      source: { kind: "run"; runId: string } | { kind: "mcp"; clientName?: string };
    }
  /** Progress of an Agent SDK run (assistant text, tool activity, completion). */
  | { type: "run_event"; runId: string; event: RunEvent };

export type RunEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; status: "started" | "finished"; isError?: boolean }
  | { kind: "usage"; inputTokens: number; outputTokens: number; costUsd?: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type { DecisionRequest, PlanStep, StepStatus };

/** Local coding-agent CLIs the bridge can run against the open document. */
export const LOCAL_AGENT_IDS = [
  "claude-code",
  "codex",
  "opencode",
  "qwen",
  "gemini",
  "cursor",
] as const;
export type LocalAgentId = (typeof LOCAL_AGENT_IDS)[number];

export type LocalAgentInfo = {
  id: LocalAgentId;
  /** Display name, e.g. "Claude Code". */
  name: string;
  installed: boolean;
  version?: string;
  /** Resolved executable path. */
  path?: string;
  /** The agent accepts a model choice (`models_request` returns options). */
  supportsModels: boolean;
  /** Why it is unavailable or what to do (e.g. "Run `codex login` once"). */
  note?: string;
};

/** Image types a run attachment may have. */
export const RUN_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type RunAttachmentType = (typeof RUN_ATTACHMENT_TYPES)[number];

/** Limits shared by the editor (composer) and the bridge (validation). */
export const RUN_ATTACHMENT_LIMITS = {
  maxCount: 6,
  /** Decoded bytes per image. */
  maxBytes: 5 * 1024 * 1024,
} as const;

/**
 * An image attached to a run. `id` is stable within the run ("att-1"…): tools can refer to it
 * (e.g. `place_image` with src "attachment:att-1") so the agent can put the image on the canvas.
 */
export type RunAttachment = {
  id: string;
  name: string;
  mediaType: RunAttachmentType;
  /** Base64 (no data: prefix). */
  data: string;
  width?: number;
  height?: number;
};
