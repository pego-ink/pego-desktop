import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { RunEvent } from "@pego/agent";
import { runCli } from "./process";

/**
 * Qwen Code is a fork of Gemini CLI, so both share this module: the per-run MCP server entry,
 * tool-name normalisation, the "no other tool may run" guard, the auth probe and the run loop.
 * The stream formats differ, so each adapter owns its own parser.
 */

/** Name of the MCP server entry written for each run. */
export const PEGO_SERVER = "pego";

/**
 * "mcp__pego__get_document" (Qwen), "mcp_pego_get_document" (Gemini) -> "get_document".
 * Anything that is not a Pego MCP tool is returned unchanged.
 */
export const bareToolName = (name: string): string => {
  for (const prefix of [`mcp__${PEGO_SERVER}__`, `mcp_${PEGO_SERVER}_`, `${PEGO_SERVER}__`]) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
};

export const isPegoTool = (name: string): boolean => bareToolName(name) !== name;

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** Parse one JSONL line; anything that is not a JSON object is ignored (banners, warnings). */
export const parseJsonLine = (line: string): Record<string, unknown> | undefined => {
  if (!line.startsWith("{")) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Pego prompt + task in one string, for CLIs without a system-prompt mechanism of their own. */
export const withSystemPrompt = (systemPrompt: string, prompt: string): string =>
  systemPrompt.trim() === "" ? prompt : `${systemPrompt.trim()}\n\n---\n\nTask:\n${prompt}`;

/** The MCP server entry both CLIs understand for Streamable HTTP (`httpUrl`, not `url`/SSE). */
export const pegoMcpServerEntry = (mcpUrl: string) => ({
  httpUrl: mcpUrl,
  /** Run Pego's tools without a confirmation prompt (nothing else is allowed to run). */
  trust: true,
});

export const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  const dir = path.slice(0, path.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

/** Read-only peek at a CLI's own settings file (never written). Missing/invalid -> {}. */
export const readJsonSettings = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return asRecord(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return {};
  }
};

export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};

export const homeOf = (env: Record<string, string>): string => env.HOME ?? homedir();

/** The `security.auth.selectedType` a Gemini-CLI-family settings file declares, if any. */
export const selectedAuthType = (settings: Record<string, unknown>): string | undefined =>
  asString(asRecord(asRecord(settings.security).auth).selectedType) || undefined;

export type StreamParser = {
  /**
   * Feed one stdout line. `violation` means the CLI tried to use something other than Pego's
   * tools; the run is stopped.
   */
  push: (line: string) => { events: RunEvent[]; violation?: string };
};

export type FamilyRunOptions = {
  label: string;
  command: string;
  args: string[];
  stdin?: string;
  env: Record<string, string>;
  cwd: string;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
  parser: StreamParser;
  /** Added to the error when the failure output looks like a missing login. */
  loginHint: string;
};

const LOOKS_LIKE_AUTH =
  /auth|log ?in|credential|api key|unauthori[sz]ed|\b401\b|\b403\b|please set an auth method/i;

/** One-line, user-facing reason a CLI run failed, from its stderr tail. */
export const describeFailure = (
  label: string,
  stderrTail: string[],
  exitCode: number | null,
  loginHint: string,
): string => {
  const text = stderrTail.join("\n");
  if (LOOKS_LIKE_AUTH.test(text)) return loginHint;
  const meaningful = stderrTail
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/yolo mode|^\[STARTUP\]|^warning:/i.test(line));
  const last = meaningful.at(-1);
  const code = exitCode === null ? "" : ` (exit ${exitCode})`;
  return `${label} stopped${code}${last ? `: ${last.slice(0, 300)}` : "."}`;
};

/**
 * Run one CLI process, turn its stdout into RunEvents and guarantee one terminal event unless
 * the run was aborted (the run manager reports cancellation itself).
 */
export const runFamilyCli = async (options: FamilyRunOptions): Promise<void> => {
  const stop = new AbortController();
  const forwardAbort = () => stop.abort();
  if (options.signal.aborted) return;
  options.signal.addEventListener("abort", forwardAbort, { once: true });
  let terminal = false;
  let violated = false;
  const emit = (event: RunEvent) => {
    if (terminal) return;
    if (event.kind === "done" || event.kind === "error") terminal = true;
    options.emit(event);
  };
  try {
    const result = await runCli({
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin ?? "",
      signal: stop.signal,
      onStdoutLine: (line) => {
        if (violated) return;
        const { events, violation } = options.parser.push(line);
        for (const event of events) emit(event);
        if (violation) {
          violated = true;
          emit({ kind: "error", message: violation });
          stop.abort();
        }
      },
    });
    if (options.signal.aborted || terminal) return;
    if (result.spawnError) {
      emit({ kind: "error", message: `Could not start ${options.label}: ${result.spawnError}` });
      return;
    }
    emit({
      kind: "error",
      message: describeFailure(
        options.label,
        result.stderrTail,
        result.exitCode,
        options.loginHint,
      ),
    });
  } finally {
    options.signal.removeEventListener("abort", forwardAbort);
  }
};
