import type { DecisionRequest, PlanStep, StepStatus } from "./types";

/**
 * WebSocket protocol between the editor tab (client) and the local bridge (`apps/bridge`).
 * The bridge never touches the document: every tool call is executed by the editor through
 * the shared tool specs, so Claude Code (MCP or Agent SDK) and the in-browser agent edit the
 * document the same way.
 */
export const BRIDGE_DEFAULT_PORT = 4519;
export const BRIDGE_PROTOCOL_VERSION = 5;

/**
 * A project: a folder in the design folder with a project.json (id, name) and its design,
 * project.pego (one document).
 */
export type ProjectInfo = {
  id: string;
  name: string;
  /** Absolute folder path. */
  dir: string;
  /** Absolute path of the project's design, `<dir>/project.pego`. */
  mainFile: string;
  /** False until project.pego exists (it is created when the project is opened). */
  hasMainFile: boolean;
  /** Folder inside the design folder, e.g. "checkout". */
  relativeDir: string;
  fileCount: number;
  /** Latest file change (ms since epoch), 0 when the project has no files. */
  modifiedAt: number;
  createdAt: string;
};

/**
 * The project a tool call works on when it is not the one the editor shows: the editor edits that
 * project's design in the background (and saves it) without switching the window.
 */
export type ToolTarget = { project: Pick<ProjectInfo, "id" | "name" | "dir" | "mainFile"> };

/** A design file in the design folder. */
export type ProjectFile = {
  /** Absolute path on disk. */
  path: string;
  /** Path inside the design folder with "/" separators, e.g. "app/checkout.pego". */
  relativePath: string;
  size: number;
  modifiedAt: number;
};

/**
 * Editor-side operations the bridge invokes through `tool_call` for its file tools
 * (`open_document`, `save_document`, projects). They are not agent tools: no model sees them.
 */
export const EDITOR_OPS = {
  /** Input `{ text, path, discardUnsaved? }`: parse a .pego file and make it the open document. */
  loadDocument: "pego.load_document",
  /** Result JSON `{ text, path, name, snapshotId }`: the open document serialized for saving. */
  snapshotDocument: "pego.snapshot_document",
  /** Input `{ snapshotId, path }`: the snapshot was written to `path`; mark it saved. */
  markSaved: "pego.mark_saved",
  /** Result JSON `{ project, tabs: [{ title, path, dirty, active }] }`: the open documents. */
  listTabs: "pego.list_tabs",
  /** Input `{ path }`: show the tab of that file; an error when it is not open. */
  switchTab: "pego.switch_tab",
  /** Input a ProjectInfo: open (or show) that project's workspace in the editor. */
  openProject: "pego.open_project",
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
  | { type: "run_cancel"; runId: string }
  /** Write the open document to a file on disk (a project's design, or a file the bridge opened). */
  | { type: "save_file"; requestId: string; path: string; text: string }
  /**
   * The dashboard: list projects, create one (`name`), list the files of a folder (`path`,
   * default the whole design folder) or read one file (`path`).
   */
  | {
      type: "project_request";
      requestId: string;
      action: "list" | "read" | "projects" | "create_project";
      path?: string;
      name?: string;
    };

/** Messages the bridge sends to the editor. */
export type BridgeToEditor =
  | {
      type: "welcome";
      protocol: number;
      claudeCodeAvailable: boolean;
      mcpUrl: string;
      agents: LocalAgentInfo[];
      /** The design folder holding the projects, or null when the bridge has none. */
      projectDir: string | null;
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
      /** Work on this project instead of the shown document (MCP calls with `project`). */
      target?: ToolTarget;
    }
  /** Progress of an Agent SDK run (assistant text, tool activity, completion). */
  | { type: "run_event"; runId: string; event: RunEvent }
  | { type: "save_file_result"; requestId: string; ok: boolean; error?: string }
  | {
      type: "project_response";
      requestId: string;
      ok: boolean;
      error?: string;
      root?: string | null;
      files?: ProjectFile[];
      text?: string;
      projects?: ProjectInfo[];
      project?: ProjectInfo;
    };

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
