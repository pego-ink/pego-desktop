import type { DecisionRequest, PlanStep, StepStatus } from "./types";

/**
 * WebSocket protocol between the editor tab (client) and the local bridge (`apps/bridge`).
 * The bridge never touches the document: every tool call is executed by the editor through
 * the shared tool specs, so Claude Code (MCP or Agent SDK) and the in-browser agent edit the
 * document the same way.
 */
export const BRIDGE_DEFAULT_PORT = 4519;
export const BRIDGE_PROTOCOL_VERSION = 1;

/** Messages the editor sends to the bridge. */
export type EditorToBridge =
  | { type: "hello"; protocol: number; documentName: string }
  /** Result of a `tool_call` the bridge forwarded. */
  | { type: "tool_result"; callId: string; content: string; isError: boolean }
  /** Start a Claude Agent SDK run with the user's local Claude Code login. */
  | { type: "run_start"; runId: string; prompt: string }
  | { type: "run_cancel"; runId: string };

/** Messages the bridge sends to the editor. */
export type BridgeToEditor =
  | { type: "welcome"; protocol: number; claudeCodeAvailable: boolean; mcpUrl: string }
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
