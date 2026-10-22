import { join } from "node:path";
import { withAtFileReferences } from "../attachments";
import type { RunEvent } from "@pego/agent";
import {
  asNumber,
  asRecord,
  asString,
  bareToolName,
  fileExists,
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
import type { AgentAdapter, AgentDetection } from "./types";

const LOGIN_HINT = "Qwen Code is not logged in. Run `qwen` once in a terminal to choose a login.";
const FIRST_RUN_NOTE = "First run may ask you to log in: run `qwen` once in a terminal.";

/** Curated; the model a user configured in Qwen Code is added to the front when known. */
const CURATED_MODELS = [
  "coder-model",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "qwen3-coder-plus",
];

/**
 * Built-in tools switched off for a run (`--exclude-tools`). `--core-tools` is not enough: the
 * "always on" tools (agent, skill, memory, cron, worktree...) ignore it.
 */
export const QWEN_EXCLUDED_TOOLS = [
  "run_shell_command",
  "write_file",
  "edit",
  "notebook_edit",
  "read_file",
  "glob",
  "grep_search",
  "list_directory",
  "web_fetch",
  "web_search",
  "agent",
  "skill",
  "manage_memory",
  "search_memory",
  "cron_create",
  "cron_list",
  "cron_delete",
  "enter_worktree",
  "exit_worktree",
  "loop_wakeup",
  "record_artifact",
  "send_message",
  "task_stop",
  "list_agents",
  "report_findings",
  "read_mcp_resource",
  "get_goal",
  "update_goal",
  "zoom_image",
  "tool_search",
  "tool_call",
];

/** If any of these shows up in the CLI's tool list, the run is refused (fail closed). */
const FORBIDDEN_TOOLS = new Set([
  "run_shell_command",
  "write_file",
  "edit",
  "notebook_edit",
  "read_file",
  "web_fetch",
  "agent",
  "skill",
  "manage_memory",
]);

/** MCP config file for `--mcp-config`. `alwaysLoadTools` keeps Pego's tools out of tool_search. */
export const buildQwenMcpConfig = (mcpUrl: string) => ({
  mcpServers: { [PEGO_SERVER]: { ...pegoMcpServerEntry(mcpUrl), alwaysLoadTools: true } },
});

export const buildQwenArgs = (input: {
  mcpConfigPath: string;
  model?: string;
  systemPrompt: string;
}): string[] => [
  // Safe mode: no user hooks/extensions/skills/context files/MCP servers, but the user's login.
  "--safe-mode",
  "-o",
  "stream-json",
  "--approval-mode",
  "yolo",
  "--mcp-config",
  input.mcpConfigPath,
  ...(input.model ? ["-m", input.model] : []),
  ...(input.systemPrompt.trim() !== ""
    ? [`--append-system-prompt=${input.systemPrompt.trim()}`]
    : []),
  // Array options swallow following positionals: keep them last (the prompt goes on stdin).
  "--allowed-mcp-server-names",
  PEGO_SERVER,
  "--exclude-tools",
  ...QWEN_EXCLUDED_TOOLS,
];

const describeResultError = (detail: string): string => {
  if (/no auth type|missing api key|no active credentials|\b401\b|\b403\b/i.test(detail)) {
    return `${LOGIN_HINT} (${detail.slice(0, 200)})`;
  }
  return detail === "" ? "Qwen Code reported an error." : `Qwen Code: ${detail.slice(0, 400)}`;
};

/** Qwen Code `-o stream-json` (Claude-style system/assistant/user/result messages). */
export const createQwenParser = (): StreamParser => {
  const toolNames = new Map<string, string>();
  return {
    push: (line) => {
      const message = parseJsonLine(line);
      if (!message) return { events: [] };
      const events: RunEvent[] = [];
      const type = message.type;
      if (type === "system" && message.subtype === "init") {
        const offending = (Array.isArray(message.tools) ? message.tools : [])
          .map(asString)
          .find((tool) => FORBIDDEN_TOOLS.has(tool));
        if (offending) {
          return {
            events,
            violation: `Qwen Code still offers the "${offending}" tool; refusing to run it against your document.`,
          };
        }
        return { events };
      }
      if (type === "assistant" && !message.parent_tool_use_id) {
        const content = asRecord(message.message).content;
        for (const raw of Array.isArray(content) ? content : []) {
          const block = asRecord(raw);
          if (block.type === "text") {
            const text = asString(block.text);
            // API failures are also reported by the final `result`; do not show them twice.
            if (text !== "" && !text.startsWith("[API Error:")) events.push({ kind: "text", text });
          } else if (block.type === "tool_use") {
            const name = asString(block.name);
            if (!isPegoTool(name)) {
              return {
                events,
                violation: `Qwen Code tried to use "${name}", which is not a Pego tool. Run stopped.`,
              };
            }
            toolNames.set(asString(block.id), bareToolName(name));
            events.push({ kind: "tool", tool: bareToolName(name), status: "started" });
          }
        }
        return { events };
      }
      if (type === "user") {
        const content = asRecord(message.message).content;
        for (const raw of Array.isArray(content) ? content : []) {
          const block = asRecord(raw);
          if (block.type !== "tool_result") continue;
          const tool = toolNames.get(asString(block.tool_use_id));
          if (!tool) continue;
          events.push({
            kind: "tool",
            tool,
            status: "finished",
            ...(block.is_error === true ? { isError: true } : {}),
          });
        }
        return { events };
      }
      if (type === "result") {
        if (message.is_error === true || message.subtype !== "success") {
          const detail = asString(asRecord(message.error).message) || asString(message.result);
          events.push({ kind: "error", message: describeResultError(detail) });
          return { events };
        }
        const usage = asRecord(message.usage);
        events.push({
          kind: "usage",
          inputTokens: asNumber(usage.input_tokens),
          outputTokens: asNumber(usage.output_tokens),
        });
        events.push({ kind: "done" });
      }
      return { events };
    },
  };
};

const detect: AgentAdapter["detect"] = async (env): Promise<AgentDetection> => {
  const candidates = findExecutables("qwen", env);
  const found = await probeVersion(candidates, env);
  if (!found) {
    return candidates.length > 0
      ? { installed: false, note: "`qwen` is on PATH but does not run (`qwen --version` failed)." }
      : { installed: false, note: "Install Qwen Code: `npm i -g @qwen-code/qwen-code`." };
  }
  const dir = join(homeOf(env), ".qwen");
  const settings = await readJsonSettings(join(dir, "settings.json"));
  const loggedIn =
    selectedAuthType(settings) !== undefined || (await fileExists(join(dir, "oauth_creds.json")));
  return {
    installed: true,
    path: found.path,
    version: extractVersion(found.version),
    ...(loggedIn ? {} : { note: FIRST_RUN_NOTE }),
  };
};

const listModels: NonNullable<AgentAdapter["listModels"]> = async (env) => {
  const settings = await readJsonSettings(join(homeOf(env), ".qwen", "settings.json"));
  const configured = asString(asRecord(settings.model).name);
  return [...new Set([...(configured ? [configured] : []), ...CURATED_MODELS])];
};

export const qwenAdapter: AgentAdapter = {
  id: "qwen",
  name: "Qwen Code",
  supportsModels: true,
  detect,
  listModels,
  run: async (ctx) => {
    const command = findExecutables("qwen", ctx.env)[0];
    if (!command) {
      ctx.emit({ kind: "error", message: "Qwen Code is not installed." });
      return;
    }
    const mcpConfigPath = join(ctx.workdir, "pego-mcp.json");
    await writeJsonFile(mcpConfigPath, buildQwenMcpConfig(ctx.mcpUrl));
    await runFamilyCli({
      label: "Qwen Code",
      command,
      args: buildQwenArgs({
        mcpConfigPath,
        ...(ctx.model ? { model: ctx.model } : {}),
        systemPrompt: ctx.systemPrompt,
      }),
      stdin: withAtFileReferences(ctx.prompt, ctx.attachments),
      env: { ...ctx.env, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1" },
      cwd: ctx.workdir,
      signal: ctx.signal,
      emit: ctx.emit,
      parser: createQwenParser(),
      loginHint: LOGIN_HINT,
    });
  },
};
