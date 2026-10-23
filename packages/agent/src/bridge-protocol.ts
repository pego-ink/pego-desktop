import type { DecisionRequest, PlanStep, StepStatus, ToolImage } from "./types";

/**
 * WebSocket protocol between the editor tab (client) and the local bridge (`apps/bridge`).
 * The bridge never touches the document: every tool call is executed by the editor through
 * the shared tool specs, so Claude Code (MCP or Agent SDK) and the in-browser agent edit the
 * document the same way.
 */
export const BRIDGE_DEFAULT_PORT = 4519;
/**
 * v7 = v6 + `trash_project` (editor only, never an MCP tool). v6 = v4 (local agents, several editors,
 * parallel runs, run_steer) + v5 (projects, file tools).
 * Several editors connect at once; MCP calls go to the focused one (see apps/bridge editor-hub).
 */
export const BRIDGE_PROTOCOL_VERSION = 8;

/** Local agent runs the bridge executes at the same time (one per chat session). */
export const MAX_CONCURRENT_RUNS = 3;

/**
 * A project: a folder in the design folder with a project.json (id, name) and its design,
 * project.pego (one document; screens are its pages).
 */
/** The project an MCP tool call targets (resolved by the bridge from its id or name). */
export type ProjectTarget = { id: string; name: string; dir: string; mainFile: string };

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

/** A design file in the project folder (the bridge lists `design/` of the repo it runs in). */
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
 * (`open_document`, `save_document`). They are not agent tools: no model ever sees them. They go
 * to the focused editor, like MCP tool calls.
 */
export const EDITOR_OPS = {
  /** Input `{ text, path, discardUnsaved? }`: parse a .pego/.pen file and make it the open document. */
  loadDocument: "pego.load_document",
  /** Result JSON `{ text, path, name, snapshotId }`: the open document serialized for saving. */
  snapshotDocument: "pego.snapshot_document",
  /** Input `{ snapshotId, path }`: the snapshot was written to `path`; mark it saved. */
  markSaved: "pego.mark_saved",
  /** Result JSON `{ tabs: [{ title, path, dirty, active }] }`: the open documents. */
  listTabs: "pego.list_tabs",
  /** Input `{ path }`: show the tab of that file; an error when it is not open. */
  switchTab: "pego.switch_tab",
  /** Input a ProjectInfo: open (or show) that project's tab in the editor. */
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
      /** Base64 images (e.g. get_screenshot); the bridge maps them to MCP image content. */
      images?: ToolImage[];
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
  /**
   * Steer a running run: hand it a new user message without waiting for it to finish. Only for
   * agents whose `steer` is "native"; the editor restarts the others itself.
   */
  | { type: "run_steer"; runId: string; text: string; attachments?: RunAttachment[] }
  /** Save the open document to a file the bridge opened it from (File → Save in the editor). */
  | { type: "save_file"; requestId: string; path: string; text: string }
  /**
   * The dashboard and project panel: list projects, create one (`name`), list the files of a
   * folder (`path`, default the whole design folder) or read one file (`path`). `trash_project`
   * moves the project `projectId` to the OS Trash; the bridge looks the folder up itself.
   */
  | {
      type: "project_request";
      requestId: string;
      action: "list" | "read" | "projects" | "create_project" | "trash_project";
      path?: string;
      name?: string;
      projectId?: string;
    };

/** Messages the bridge sends to the editor. */
export type BridgeToEditor =
  | {
      type: "welcome";
      protocol: number;
      claudeCodeAvailable: boolean;
      mcpUrl: string;
      agents: LocalAgentInfo[];
      /** The project's design folder, or null when the bridge found none. */
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
      /**
       * Who is calling: an Agent SDK run started from the panel, or Claude Code over MCP. An MCP
       * call naming a `project` edits that project's design, in a background tab when another
       * one is shown.
       */
      source:
        | { kind: "run"; runId: string }
        | { kind: "mcp"; clientName?: string; project?: ProjectTarget };
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
  /** A `run_steer` message reached the agent (it reads it at its next turn). */
  | { kind: "steered"; text: string }
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
  /**
   * How a running run takes a steer message: "native" accepts `run_steer` mid-run (Claude Code),
   * "restart" means the editor cancels and starts a new run with the message plus session history.
   */
  steer: "native" | "restart";
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
