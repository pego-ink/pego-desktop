import type { DecisionRequest, PlanStep, StepStatus } from "./types";

/**
 * WebSocket protocol between the editor tab (client) and the local bridge (`apps/bridge`).
 * The bridge never touches the document: every tool call is executed by the editor through
 * the shared tool specs, so Claude Code (MCP or Agent SDK) and the in-browser agent edit the
 * document the same way.
 */
export const BRIDGE_DEFAULT_PORT = 4519;
export const BRIDGE_PROTOCOL_VERSION = 3;
/**
 * WebSocket close code the bridge sends to an editor tab when a newer tab takes its place. The
 * replaced tab must not reconnect on its own (two tabs would take turns forever); it waits for
 * the user to pick it again.
 */
export const BRIDGE_REPLACED_CLOSE_CODE = 4000;

/**
 * Editor-side operations the bridge invokes through `tool_call` for its file tools
 * (`open_document`, `save_document`). They are not agent tools: no model ever sees them.
 */
export const EDITOR_OPS = {
  /** Input `{ text, path, discardUnsaved? }`: parse a .pego/.pen file and make it the open document. */
  loadDocument: "pego.load_document",
  /** Result JSON `{ text, path, name, snapshotId }`: the open document serialized for saving. */
  snapshotDocument: "pego.snapshot_document",
  /** Input `{ snapshotId, path }`: the snapshot was written to `path`; mark it saved. */
  markSaved: "pego.mark_saved",
} as const;

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
  /** Start a Claude Agent SDK run with the user's local Claude Code login. */
  | { type: "run_start"; runId: string; prompt: string }
  | { type: "run_cancel"; runId: string }
  /** Save the open document to a file the bridge opened it from (File → Save in the editor). */
  | { type: "save_file"; requestId: string; path: string; text: string };

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
  | { type: "run_event"; runId: string; event: RunEvent }
  | { type: "save_file_result"; requestId: string; ok: boolean; error?: string };

export type RunEvent =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: string; status: "started" | "finished"; isError?: boolean }
  | { kind: "usage"; inputTokens: number; outputTokens: number; costUsd?: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type { DecisionRequest, PlanStep, StepStatus };
