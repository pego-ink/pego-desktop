import { join, resolve } from "node:path";
import type { RunEvent } from "@pego/agent";
import {
  asRecord,
  asString,
  parseJsonLine,
  PEGO_SERVER,
  runFamilyCli,
  withSystemPrompt,
  writeJsonFile,
  type StreamParser,
} from "./gemini-family";
import { extractVersion, findExecutables, probeVersion, runCapture, stripAnsi } from "./process";
import { ATTACHMENTS_DIR, type AgentAttachment } from "../attachments";
import type { AgentAdapter, AgentDetection } from "./types";

const LOGIN_HINT = "Cursor Agent is not logged in. Run `cursor-agent login` once in a terminal.";
const FALLBACK_MODELS = ["auto"];

/**
 * `<workdir>/.cursor/mcp.json`: Pego's MCP server for this run (Streamable HTTP is inferred
 * from the `url` key).
 */
export const buildCursorMcpConfig = (mcpUrl: string) => ({
  mcpServers: { [PEGO_SERVER]: { url: mcpUrl } },
});

/**
 * `<workdir>/.cursor/cli.json`: only Pego's MCP tools may run. Deny rules win over allow rules,
 * so shell, file access and web fetches are denied even if a mode would otherwise allow them.
 */
export const buildCursorCliConfig = (options: { attachments?: boolean } = {}) => ({
  permissions: options.attachments
    ? {
        // Cursor Agent has no image flag: the model views attachments through its read tool.
        // Deny rules win over allow rules, so a blanket `Read(**)` deny cannot coexist with the
        // attachments allow. Every other read stays unapproved (no `--force`) and the parser
        // stops the run on any read outside `attachments/`.
        allow: [`Mcp(${PEGO_SERVER}:*)`, `Read(${ATTACHMENTS_DIR}/**)`],
        deny: ["Shell(*)", "Write(**)", "WebFetch(*)"],
      }
    : {
        allow: [`Mcp(${PEGO_SERVER}:*)`],
        deny: ["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)"],
      },
});

const ATTACHMENT_FILE = /^att-\d{1,6}\.(png|jpg|webp|gif)$/;

/** True when a read tool call targets one of this run's attachment files and nothing else. */
export const isAttachmentRead = (toolCall: Record<string, unknown>, workdir: string): boolean => {
  const path = asString(asRecord(asRecord(toolCall.readToolCall).args).path);
  if (path === "") return false;
  const resolved = resolve(workdir, path);
  const dir = join(workdir, ATTACHMENTS_DIR);
  return resolved.startsWith(`${dir}/`) && ATTACHMENT_FILE.test(resolved.slice(dir.length + 1));
};

/** Prompt addition telling the agent where the images are (Cursor Agent has no image flag). */
export const cursorAttachmentNote = (attachments: readonly AgentAttachment[]): string =>
  attachments.length === 0
    ? ""
    : `\nThe images are files in the workspace; open them with your read tool to look at them: ${attachments
        .map((item) => item.relativePath)
        .join(", ")}.`;

export const buildCursorArgs = (input: { workdir: string; model?: string; prompt: string }) => [
  "--print",
  "--output-format",
  "stream-json",
  "--trust",
  "--approve-mcps",
  "--workspace",
  input.workdir,
  ...(input.model ? ["--model", input.model] : []),
  // No `--force`: anything not allowed in cli.json stays unapproved in a non-interactive run.
  "--",
  input.prompt,
];

/** Which tool a `tool_call` event is about: `{ <kind>ToolCall: {...} }` or `{ function: ... }`. */
const describeToolCall = (
  toolCall: Record<string, unknown>,
): { name: string; mcp: boolean; failed: boolean } => {
  const mcp = asRecord(toolCall.mcpToolCall);
  if (Object.keys(mcp).length > 0) {
    const args = asRecord(mcp.args);
    const provider = asString(args.providerIdentifier);
    const tool = asString(args.toolName) || asString(args.name);
    const bare = tool.startsWith(`${PEGO_SERVER}-`) ? tool.slice(PEGO_SERVER.length + 1) : tool;
    const result = asRecord(mcp.result);
    const success = asRecord(result.success);
    const failed =
      result.error !== undefined || result.rejected !== undefined || success.isError === true;
    return { name: bare, mcp: provider === "" || provider === PEGO_SERVER, failed };
  }
  const fn = asRecord(toolCall.function);
  if (Object.keys(fn).length > 0) {
    return { name: asString(fn.name), mcp: false, failed: false };
  }
  const [kind = "unknown"] = Object.keys(toolCall);
  return { name: kind.replace(/ToolCall$/, ""), mcp: false, failed: false };
};

/** Cursor Agent `--output-format stream-json` (system / user / assistant / tool_call / result). */
export const createCursorParser = (options: { workdir?: string } = {}): StreamParser => {
  const started = new Set<string>();
  return {
    push: (line) => {
      const event = parseJsonLine(line);
      if (!event) return { events: [] };
      const events: RunEvent[] = [];
      if (event.type === "assistant") {
        const content = asRecord(event.message).content;
        for (const raw of Array.isArray(content) ? content : []) {
          const block = asRecord(raw);
          const text = asString(block.text);
          if (block.type === "text" && text !== "") events.push({ kind: "text", text });
        }
        return { events };
      }
      if (event.type === "tool_call") {
        const toolCall = asRecord(event.tool_call);
        // Reading an attached image is the one non-Pego tool a run may use.
        if (options.workdir && isAttachmentRead(toolCall, options.workdir)) return { events };
        const call = describeToolCall(toolCall);
        if (!call.mcp) {
          return {
            events,
            violation: `Cursor Agent tried to use "${call.name}", which is not a Pego tool. Run stopped.`,
          };
        }
        const id = asString(event.call_id);
        if (event.subtype === "started") {
          started.add(id);
          events.push({ kind: "tool", tool: call.name, status: "started" });
        } else if (event.subtype === "completed") {
          if (!started.has(id)) events.push({ kind: "tool", tool: call.name, status: "started" });
          events.push({
            kind: "tool",
            tool: call.name,
            status: "finished",
            ...(call.failed ? { isError: true } : {}),
          });
        }
        return { events };
      }
      if (event.type === "result") {
        if (
          event.is_error === true ||
          (event.subtype !== undefined && event.subtype !== "success")
        ) {
          const detail = asString(event.result) || asString(asRecord(event.error).message);
          events.push({
            kind: "error",
            message: `Cursor Agent: ${detail.slice(0, 400) || "failed."}`,
          });
          return { events };
        }
        events.push({ kind: "done" });
      }
      return { events };
    },
  };
};

const detect: AgentAdapter["detect"] = async (env): Promise<AgentDetection> => {
  const candidates = findExecutables("cursor-agent", env);
  const found = await probeVersion(candidates, env);
  if (!found) {
    return candidates.length > 0
      ? { installed: false, note: "`cursor-agent` is on PATH but does not run." }
      : { installed: false, note: "Install Cursor Agent: https://cursor.com/cli" };
  }
  const base = { installed: true, path: found.path, version: extractVersion(found.version) };
  if (env.CURSOR_API_KEY) return base;
  const status = await runCapture(found.path, ["status"], { env, timeoutMs: 8000 });
  if (/not logged in|authentication required/i.test(`${status.stdout}\n${status.stderr}`)) {
    return { ...base, note: LOGIN_HINT };
  }
  return base;
};

/** `id - Display Name` lines (optionally with markers); header/footer prose is skipped. */
export const parseCursorModels = (output: string): string[] => {
  const ids: string[] = [];
  for (const line of stripAnsi(output).split("\n")) {
    const match = /^\s*(?:[*>•-]\s+)?([a-z0-9][a-z0-9._-]*)\s+-\s+\S/i.exec(line);
    if (match?.[1] && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
};

const listModels: NonNullable<AgentAdapter["listModels"]> = async (env) => {
  const command = findExecutables("cursor-agent", env)[0];
  if (!command) return FALLBACK_MODELS;
  const result = await runCapture(command, ["--list-models"], { env, timeoutMs: 15_000 });
  const ids = result.exitCode === 0 ? parseCursorModels(result.stdout) : [];
  return ids.length > 0 ? ids : FALLBACK_MODELS;
};

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  name: "Cursor Agent",
  supportsModels: true,
  detect,
  listModels,
  run: async (ctx) => {
    const command = findExecutables("cursor-agent", ctx.env)[0];
    if (!command) {
      ctx.emit({ kind: "error", message: "Cursor Agent is not installed." });
      return;
    }
    await writeJsonFile(join(ctx.workdir, ".cursor", "mcp.json"), buildCursorMcpConfig(ctx.mcpUrl));
    const attachments = ctx.attachments ?? [];
    await writeJsonFile(
      join(ctx.workdir, ".cursor", "cli.json"),
      buildCursorCliConfig({ attachments: attachments.length > 0 }),
    );
    await runFamilyCli({
      label: "Cursor Agent",
      command,
      args: buildCursorArgs({
        workdir: ctx.workdir,
        ...(ctx.model ? { model: ctx.model } : {}),
        prompt: withSystemPrompt(
          ctx.systemPrompt,
          `${ctx.prompt}${cursorAttachmentNote(attachments)}`,
        ),
      }),
      env: ctx.env,
      cwd: ctx.workdir,
      signal: ctx.signal,
      emit: ctx.emit,
      parser: createCursorParser({ workdir: ctx.workdir }),
      loginHint: LOGIN_HINT,
    });
  },
};
