import type { Op, PegoDocument } from "@pego/doc";

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
};

/** Tool output in a provider-neutral shape (maps to tool_result / MCP CallToolResult). */
export type ToolResult = { content: string; isError: boolean };

/** JSON Schema for a tool's input object. */
export type JsonSchema = Record<string, unknown>;

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Validate input and run it against the host. Never throws: errors become `isError` results. */
  run: (input: unknown, host: ToolHost) => Promise<ToolResult>;
};
