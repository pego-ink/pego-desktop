import type { RunEvent } from "@pego/agent";
import { SDK_SERVER_NAME } from "../config";

/** Loose view of one `opencode run --format json` line. */
type OpencodeLine = {
  type?: string;
  error?: { name?: string; message?: string; data?: { message?: string }; type?: string };
  part?: {
    id?: string;
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: string;
      error?: string;
      /** Code-mode `execute` reports the MCP calls it made here. */
      metadata?: { metadata?: { toolCalls?: Array<{ tool?: string; status?: string }> } };
    };
    reason?: string;
    cost?: number;
    tokens?: { input?: number; output?: number; reasoning?: number };
  };
};

export type OpencodeMapState = {
  /** Token/cost totals accumulated over `step_finish` events. */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** A fatal `error` line was seen (emitted once). */
  failed: boolean;
};

export const createOpencodeState = (): OpencodeMapState => ({
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  failed: false,
});

const PEGO_PREFIX = `${SDK_SERVER_NAME}_`;
const PEGO_DOT_PREFIX = `${SDK_SERVER_NAME}.`;
export const CODE_MODE_TOOL = "execute";
/** opencode names MCP tools `<server>_<tool>`. */
export const bareOpencodeTool = (name: string): string =>
  name.startsWith(PEGO_PREFIX) ? name.slice(PEGO_PREFIX.length) : name;

const describeError = (line: OpencodeLine): string => {
  const error = line.error;
  const text = error?.data?.message ?? error?.message ?? error?.name ?? "opencode failed";
  if (/api key|unauthori[sz]ed|\b401\b|not authenticated|credentials/i.test(text)) {
    return "opencode has no valid credentials for this model. Run `opencode auth login`.";
  }
  return text.slice(0, 500);
};

/** Map one stdout line of `opencode run --format json`. Non-JSON lines are ignored. */
export const mapOpencodeLine = (raw: string, state: OpencodeMapState): RunEvent[] => {
  let line: OpencodeLine;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    line = parsed as OpencodeLine;
  } catch {
    return [];
  }

  if (line.type === "text") {
    const text = line.part?.text;
    if (!text) return [];
    return [{ kind: "text", text }];
  }

  if (line.type === "tool_use") {
    const part = line.part;
    if (!part?.tool) return [];
    const status = part.state?.status;
    if (status !== "completed" && status !== "error") return [];
    // opencode 2.x routes MCP tools through its code-mode `execute` tool: the real calls
    // (`pego.get_document`) are listed in the result metadata. Internal helpers (`search`,
    // `fetch`) are not Pego tools and stay out of the activity log.
    if (part.tool === CODE_MODE_TOOL) {
      const events: RunEvent[] = [];
      for (const call of part.state?.metadata?.metadata?.toolCalls ?? []) {
        if (!call.tool?.startsWith(PEGO_DOT_PREFIX)) continue;
        const tool = call.tool.slice(PEGO_DOT_PREFIX.length);
        events.push({ kind: "tool", tool, status: "started" });
        events.push({ kind: "tool", tool, status: "finished", isError: call.status === "error" });
      }
      return events;
    }
    // Direct MCP tool (`pego_get_document`), in case a future version exposes them directly.
    if (!part.tool.startsWith(PEGO_PREFIX)) return [];
    const tool = bareOpencodeTool(part.tool);
    return [
      { kind: "tool", tool, status: "started" },
      { kind: "tool", tool, status: "finished", isError: status === "error" },
    ];
  }

  if (line.type === "step_finish") {
    const tokens = line.part?.tokens;
    state.inputTokens += tokens?.input ?? 0;
    state.outputTokens += (tokens?.output ?? 0) + (tokens?.reasoning ?? 0);
    state.costUsd += line.part?.cost ?? 0;
    return [];
  }

  if (line.type === "error") {
    if (state.failed) return [];
    state.failed = true;
    return [{ kind: "error", message: describeError(line) }];
  }

  return [];
};

/** The closing events of a run that ended cleanly (exit code 0, no fatal error line). */
export const finishOpencodeRun = (state: OpencodeMapState): RunEvent[] => [
  {
    kind: "usage",
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    ...(state.costUsd > 0 ? { costUsd: state.costUsd } : {}),
  },
  { kind: "done" },
];
