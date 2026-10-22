import type { RunEvent } from "@pego/agent";
import { SDK_SERVER_NAME } from "@/config";

/** Loose structural view of the SDK messages we read; keeps the mapper decoupled from SDK types. */
type Block = { type?: string; [key: string]: unknown };
export type SdkMessageLike = { type: string; [key: string]: unknown };

export type MapState = {
  /** tool_use id -> bare tool name, to label the matching tool_result. */
  toolNames: Map<string, string>;
  /** An error event was already emitted for this run (suppress the duplicate from `result`). */
  failed: boolean;
};

export const createMapState = (): MapState => ({ toolNames: new Map(), failed: false });

const PEGO_PREFIX = `mcp__${SDK_SERVER_NAME}__`;
const bareToolName = (name: string): string =>
  name.startsWith(PEGO_PREFIX) ? name.slice(PEGO_PREFIX.length) : name;

const LOGIN_HINT = "Claude Code is not logged in. Run `claude` once in a terminal to log in.";

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed: LOGIN_HINT,
  oauth_org_not_allowed: "Your Claude organization does not allow this login.",
  account_on_hold: "Your Claude account is on hold.",
  verification_required: "Claude needs you to verify your account. Run `claude` once to continue.",
  billing_error: "Claude reported a billing problem for this account.",
  rate_limit: "Claude rate limit reached. Try again in a moment.",
  overloaded: "Claude is overloaded. Try again in a moment.",
};

const asBlocks = (content: unknown): Block[] =>
  Array.isArray(content)
    ? content.filter((b): b is Block => typeof b === "object" && b !== null)
    : [];

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const looksLikeAuthError = (text: string): boolean =>
  /not logged in|\/login|invalid api key|authentication/i.test(text);

/**
 * Map one SDK message to zero or more run events. Pure apart from `state` bookkeeping.
 * Sub-agent traffic (`parent_tool_use_id` set) is ignored: only the main loop is shown.
 */
export const mapSdkMessage = (message: SdkMessageLike, state: MapState): RunEvent[] => {
  if (message.type === "assistant") {
    if (message.parent_tool_use_id) return [];
    const events: RunEvent[] = [];
    const body = (message.message ?? {}) as { content?: unknown };
    const errorCode = typeof message.error === "string" ? message.error : undefined;
    if (errorCode) {
      state.failed = true;
      return [
        { kind: "error", message: ASSISTANT_ERRORS[errorCode] ?? `Claude error: ${errorCode}` },
      ];
    }
    for (const block of asBlocks(body.content)) {
      if (block.type === "text" && typeof block.text === "string" && block.text !== "") {
        events.push({ kind: "text", text: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const tool = bareToolName(block.name);
        if (typeof block.id === "string") state.toolNames.set(block.id, tool);
        events.push({ kind: "tool", tool, status: "started" });
      }
    }
    return events;
  }

  if (message.type === "user") {
    if (message.parent_tool_use_id) return [];
    const body = (message.message ?? {}) as { content?: unknown };
    const events: RunEvent[] = [];
    for (const block of asBlocks(body.content)) {
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const tool = state.toolNames.get(block.tool_use_id);
      if (!tool) continue;
      state.toolNames.delete(block.tool_use_id);
      events.push({ kind: "tool", tool, status: "finished", isError: block.is_error === true });
    }
    return events;
  }

  if (message.type === "result") {
    const usage = (message.usage ?? {}) as Record<string, unknown>;
    const events: RunEvent[] = [
      {
        kind: "usage",
        inputTokens:
          num(usage.input_tokens) +
          num(usage.cache_creation_input_tokens) +
          num(usage.cache_read_input_tokens),
        outputTokens: num(usage.output_tokens),
        ...(typeof message.total_cost_usd === "number" ? { costUsd: message.total_cost_usd } : {}),
      },
    ];
    const isError = message.subtype !== "success" || message.is_error === true;
    if (!isError) return [...events, { kind: "done" }];
    if (state.failed) return events;
    state.failed = true;
    const errors = Array.isArray(message.errors) ? message.errors.map(String) : [];
    const detail =
      typeof message.result === "string" && message.result !== ""
        ? message.result
        : errors.join("; ") || String(message.subtype);
    const text = looksLikeAuthError(detail) ? LOGIN_HINT : detail;
    return [...events, { kind: "error", message: text }];
  }

  return [];
};

/** Turn a thrown error from `query()` into a user-facing message. */
export const describeRunFailure = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  if (looksLikeAuthError(text)) return LOGIN_HINT;
  if (/ENOENT|spawn/i.test(text)) {
    return "Could not start Claude Code. Is the `claude` CLI installed?";
  }
  return text.slice(0, 500);
};
