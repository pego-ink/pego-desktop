import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import {
  asNumber,
  asRecord,
  asString,
  bareToolName,
  homeOf,
  isPegoTool,
  parseJsonLine,
  pegoMcpServerEntry,
  PEGO_SERVER,
  readJsonSettings,
  runFamilyCli,
  selectedAuthType,
  writeJsonFile,
  type StreamParser,
} from "./gemini-family";
import { extractVersion, findExecutables, probeVersion } from "./process";
import { withAtFileReferences, type AgentAttachment } from "../attachments";
import type { AgentAdapter, AgentDetection } from "./types";

const LOGIN_HINT =
  "Gemini CLI is not logged in. Run `gemini` once in a terminal and choose a login method.";

const CURATED_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
];

/**
 * Every built-in tool name of Gemini CLI 0.46 (`tools.exclude`). Unknown names are ignored, so
 * the list can safely be a superset; the parser also stops the run if any non-Pego tool is
 * called.
 */
export const GEMINI_EXCLUDED_TOOLS = [
  "run_shell_command",
  "write_file",
  "replace",
  "read_file",
  "read_many_files",
  "glob",
  "grep_search",
  "list_directory",
  "web_fetch",
  "google_web_search",
  "write_todos",
  "save_memory",
  "get_internal_docs",
  "activate_skill",
  "invoke_agent",
  "ask_user",
  "complete_task",
  "enter_plan_mode",
  "exit_plan_mode",
  "update_topic",
  "take_snapshot",
  "list_mcp_resources",
  "read_mcp_resource",
  "list_background_processes",
  "read_background_output",
  "tracker_add_dependency",
  "tracker_create_task",
  "tracker_get_task",
  "tracker_list_tasks",
  "tracker_update_task",
  "tracker_visualize",
];

/** `<workdir>/.gemini/settings.json`: the project-level settings of this run only. */
export const buildGeminiSettings = (mcpUrl: string) => ({
  mcpServers: { [PEGO_SERVER]: pegoMcpServerEntry(mcpUrl) },
  mcp: { allowed: [PEGO_SERVER] },
  tools: { exclude: GEMINI_EXCLUDED_TOOLS },
});

export const buildGeminiArgs = (input: {
  model?: string;
  prompt: string;
  attachments?: AgentAttachment[];
}): string[] => [
  "-o",
  "stream-json",
  "--skip-trust",
  "--approval-mode",
  "yolo",
  ...(input.model ? ["-m", input.model] : []),
  // `--flag=value` so a prompt starting with "-" is never parsed as an option.
  `--prompt=${withAtFileReferences(input.prompt, input.attachments)}`,
  "--allowed-mcp-server-names",
  PEGO_SERVER,
];

const describeError = (detail: string): string =>
  /api key|credential|unauthori[sz]ed|\b401\b|\b403\b|auth/i.test(detail)
    ? `${LOGIN_HINT} (${detail.slice(0, 200)})`
    : `Gemini CLI: ${detail.slice(0, 400) || "reported an error."}`;

/** Gemini CLI `-o stream-json` (init / message / tool_use / tool_result / error / result). */
export const createGeminiParser = (): StreamParser => {
  const toolNames = new Map<string, string>();
  return {
    push: (line) => {
      const event = parseJsonLine(line);
      if (!event) return { events: [] };
      const events: RunEvent[] = [];
      switch (event.type) {
        case "message": {
          const text = asString(event.content);
          if (event.role === "assistant" && text !== "") events.push({ kind: "text", text });
          return { events };
        }
        case "tool_use": {
          const name = asString(event.tool_name);
          if (!isPegoTool(name)) {
            return {
              events,
              violation: `Gemini CLI tried to use "${name}", which is not a Pego tool. Run stopped.`,
            };
          }
          toolNames.set(asString(event.tool_id), bareToolName(name));
          events.push({ kind: "tool", tool: bareToolName(name), status: "started" });
          return { events };
        }
        case "tool_result": {
          const tool = toolNames.get(asString(event.tool_id));
          if (!tool) return { events };
          events.push({
            kind: "tool",
            tool,
            status: "finished",
            ...(event.status === "success" ? {} : { isError: true }),
          });
          return { events };
        }
        case "result": {
          if (event.status !== "success") {
            const detail = asString(asRecord(event.error).message);
            events.push({ kind: "error", message: describeError(detail) });
            return { events };
          }
          const stats = asRecord(event.stats);
          events.push({
            kind: "usage",
            inputTokens: asNumber(stats.input_tokens),
            outputTokens: asNumber(stats.output_tokens),
          });
          events.push({ kind: "done" });
          return { events };
        }
        default:
          // init, and non-fatal `error` warnings (fatal ones arrive as a failed `result`).
          return { events };
      }
    },
  };
};

const detect: AgentAdapter["detect"] = async (env): Promise<AgentDetection> => {
  const candidates = findExecutables("gemini", env);
  const found = await probeVersion(candidates, env);
  if (!found) {
    return candidates.length > 0
      ? {
          installed: false,
          note: "`gemini` is on PATH but does not run (`gemini --version` failed).",
        }
      : { installed: false, note: "Install Gemini CLI: `npm i -g @google/gemini-cli`." };
  }
  // Headless runs need `security.auth.selectedType` (set by the first interactive login).
  const settings = await readJsonSettings(join(homeOf(env), ".gemini", "settings.json"));
  const loggedIn = selectedAuthType(settings) !== undefined;
  return {
    installed: true,
    path: found.path,
    version: extractVersion(found.version),
    ...(loggedIn
      ? {}
      : { note: "First run may ask you to log in: run `gemini` once in a terminal." }),
  };
};

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  name: "Gemini CLI",
  supportsModels: true,
  detect,
  listModels: async () => CURATED_MODELS,
  run: async (ctx) => {
    const command = findExecutables("gemini", ctx.env)[0];
    if (!command) {
      ctx.emit({ kind: "error", message: "Gemini CLI is not installed." });
      return;
    }
    await writeJsonFile(
      join(ctx.workdir, ".gemini", "settings.json"),
      buildGeminiSettings(ctx.mcpUrl),
    );
    // Project context file of this run's (empty) workspace; the user's own GEMINI.md is untouched.
    if (ctx.systemPrompt.trim() !== "") {
      await writeFile(join(ctx.workdir, "GEMINI.md"), `${ctx.systemPrompt.trim()}\n`, {
        mode: 0o600,
      });
    }
    await runFamilyCli({
      label: "Gemini CLI",
      command,
      args: buildGeminiArgs({
        ...(ctx.model ? { model: ctx.model } : {}),
        prompt: ctx.prompt,
        ...(ctx.attachments ? { attachments: ctx.attachments } : {}),
      }),
      env: {
        ...ctx.env,
        // Workspace settings (our MCP server + tool exclusions) only apply in a trusted folder.
        GEMINI_CLI_TRUST_WORKSPACE: "true",
        GEMINI_CLI_NO_RELAUNCH: "true",
      },
      cwd: ctx.workdir,
      signal: ctx.signal,
      emit: ctx.emit,
      parser: createGeminiParser(),
      loginHint: LOGIN_HINT,
    });
  },
};
