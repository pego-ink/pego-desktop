import type { Layout, Op, PegoDocument } from "@pego/doc";

/** A step of the agent's plan, shown in the agent panel. */
export type PlanStep = { id: string; title: string; detail?: string };

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** A question the agent asks the user mid-run; the run waits for one of `options`. */
export type DecisionRequest = { question: string; options: string[]; stepId?: string };

/**
 * What a tool needs from the editor. Implemented by the web app over its document store,
 * whichever backend (in-browser API loop, Claude Code via MCP, Claude Agent SDK) calls the tool.
 */
export type ToolHost = {
  getDoc: () => PegoDocument;
  /** Apply ops as part of the current agent step (one undo step per agent step). Throws OpError. */
  applyOps: (ops: Op[]) => void;
  /** Highlight the nodes the agent is working on (ghost outline on canvas). */
  setFocus: (ids: string[]) => void;
  reportPlan: (steps: PlanStep[]) => void;
  reportStep: (stepId: string, status: StepStatus, summary?: string) => void;
  /** Resolves with the chosen option. */
  askUser: (request: DecisionRequest) => Promise<string>;

  // Editor capabilities. Optional so pure/test hosts can omit them; tools that need one
  // return an `unsupported` error when it is missing.

  /** The page the user is looking at; `parentId: null` in tools means this page. */
  getActivePageId?: () => string | null;
  /** Show this page in the editor. */
  setActivePage?: (pageId: string) => void;
  /** Computed absolute boxes of the current document (same as the renderer uses). */
  getLayout?: () => Layout;
  /** Node ids the user has selected in the editor. */
  getSelection?: () => string[];
  setSelection?: (ids: string[]) => void;
  /** Pan/zoom the user's viewport so these nodes are visible. */
  focusViewport?: (ids: string[]) => void;
  /** Icon names available to `icon` nodes (lucide, kebab-case). */
  listIcons?: () => string[];
  /** Inner SVG markup of a lucide icon on its 24x24 grid, for code export. */
  iconMarkup?: (iconName: string) => string | null;
  /** Render a node (and its subtree only) to PNG, as drawn on canvas. */
  renderImage?: (
    nodeId: string,
    options?: { scale?: number; maxSize?: number },
  ) => Promise<ToolImage>;
};

/** Base64 PNG attached to a tool result (screenshots). */
export type ToolImage = { mediaType: "image/png"; data: string; width: number; height: number };

/** Tool output in a provider-neutral shape (maps to tool_result / MCP CallToolResult). */
export type ToolResult = { content: string; isError: boolean; images?: ToolImage[] };

/** JSON Schema for a tool's input object. */
export type JsonSchema = Record<string, unknown>;

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Validate input and run it against the host. Never throws: errors become `isError` results. */
  run: (input: unknown, host: ToolHost) => Promise<ToolResult>;
};
