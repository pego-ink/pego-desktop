import type { RunEvent } from "@pego/agent";

/** Loose view of one `codex exec --json` line (item/turn events). */
type CodexLine = {
  type?: string;
  message?: string;
  error?: { message?: string };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    tool?: string;
    status?: string;
    error?: { message?: string } | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type CodexMapState = {
  /** MCP item ids whose `started` event was already emitted. */
  started: Set<string>;
  /** A terminal event (`done` or `error`) was produced. */
  finished: boolean;
  /** Last top-level `error` message (transient retries included), for exit diagnostics. */
  lastError?: string;
};

export const createCodexState = (): CodexMapState => ({ started: new Set(), finished: false });

export const CODEX_LOGIN_HINT =
  "Codex is not logged in or the login expired. Run `codex login` in a terminal.";

const looksLikeAuthError = (text: string): boolean =>
  /\b401\b|unauthorized|not logged in|sign in again|log ?in|refresh token/i.test(text);

export const describeCodexError = (text: string): string =>
  looksLikeAuthError(text) ? CODEX_LOGIN_HINT : text.slice(0, 500);

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** Map one stdout line of `codex exec --json` to run events. Non-JSON lines are ignored. */
export const mapCodexLine = (raw: string, state: CodexMapState): RunEvent[] => {
  let line: CodexLine;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    line = parsed as CodexLine;
  } catch {
    return [];
  }

  switch (line.type) {
    case "item.started":
    case "item.completed": {
      const item = line.item;
      if (!item) return [];
      if (item.type === "agent_message") {
        if (line.type !== "item.completed" || !item.text) return [];
        return [{ kind: "text", text: item.text }];
      }
      if (item.type !== "mcp_tool_call" || !item.tool) return [];
      const events: RunEvent[] = [];
      const id = item.id ?? item.tool;
      if (!state.started.has(id)) {
        state.started.add(id);
        events.push({ kind: "tool", tool: item.tool, status: "started" });
      }
      if (line.type === "item.completed") {
        state.started.delete(id);
        events.push({
          kind: "tool",
          tool: item.tool,
          status: "finished",
          isError: item.status === "failed" || (item.error !== undefined && item.error !== null),
        });
      }
      return events;
    }
    case "turn.completed":
      state.finished = true;
      return [
        {
          kind: "usage",
          inputTokens: num(line.usage?.input_tokens),
          outputTokens: num(line.usage?.output_tokens),
        },
        { kind: "done" },
      ];
    case "turn.failed":
      state.finished = true;
      return [
        {
          kind: "error",
          message: describeCodexError(
            line.error?.message ?? state.lastError ?? "Codex turn failed",
          ),
        },
      ];
    case "error":
      // Reconnect notices arrive here too; only `turn.failed` is fatal.
      if (typeof line.message === "string") state.lastError = line.message;
      return [];
    default:
      return [];
  }
};
