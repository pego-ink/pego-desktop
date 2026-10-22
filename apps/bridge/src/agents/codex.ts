import { SDK_SERVER_NAME } from "../config";
import { createCodexState, describeCodexError, mapCodexLine } from "./codex-events";
import { extractVersion, findExecutables, probeVersion, runCapture, runCli } from "./process";
import type { AgentAdapter, AgentRunContext } from "./types";

/** TOML string literal for `-c key=value` overrides (JSON strings are valid TOML basic strings). */
const toml = (value: string): string => JSON.stringify(value);

/** Features that give the model shell/web/app access; all off, only Pego's MCP tools remain. */
const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "browser_use",
  "computer_use",
  "multi_agent",
  "image_generation",
  "view_image",
  "goals",
  "hooks",
];

/**
 * `codex exec` arguments for one run. Nothing from the user's config is loaded
 * (`--ignore-user-config`, auth still comes from CODEX_HOME), the sandbox is read-only with
 * approvals off, and Pego's MCP server is injected for this run only through `-c` overrides.
 * The prompt is read from stdin (`-`).
 */
export const buildCodexArgs = (
  input: Pick<AgentRunContext, "mcpUrl" | "systemPrompt" | "workdir" | "model" | "attachments">,
): string[] => {
  const server = `mcp_servers.${SDK_SERVER_NAME}`;
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    // `-i` takes a variadic list: one flag per file, always followed by another option so the
    // trailing `-` (prompt on stdin) is never swallowed as an image path.
    ...(input.attachments ?? []).flatMap((item) => ["-i", item.path]),
    "-s",
    "read-only",
    "-C",
    input.workdir,
    "-c",
    `approval_policy=${toml("never")}`,
    "-c",
    `web_search=${toml("disabled")}`,
    "-c",
    `developer_instructions=${toml(input.systemPrompt)}`,
    "-c",
    `${server}.url=${toml(input.mcpUrl)}`,
    "-c",
    `${server}.default_tools_approval_mode=${toml("approve")}`,
    "-c",
    `${server}.startup_timeout_sec=20`,
    "-c",
    `${server}.tool_timeout_sec=120`,
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...(input.model ? ["-m", input.model] : []),
    "-",
  ];
};

/** Curated fallback when the CLI cannot report its catalog. */
const FALLBACK_MODELS = ["gpt-5.5"];

export const parseCodexCatalog = (json: string): string[] => {
  const parsed = JSON.parse(json) as { models?: Array<{ slug?: unknown; visibility?: unknown }> };
  return (parsed.models ?? [])
    .filter((model) => model.visibility === "list" && typeof model.slug === "string")
    .map((model) => model.slug as string);
};

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "Codex",
  supportsModels: true,

  detect: async (env) => {
    const found = await probeVersion(findExecutables("codex", env), env);
    if (!found)
      return {
        installed: false,
        note: "Codex CLI was not found. Install it with `npm i -g @openai/codex`.",
      };
    const info = { installed: true, path: found.path, version: extractVersion(found.version) };
    const login = await runCapture(found.path, ["login", "status"], { env, timeoutMs: 8000 });
    if (login.exitCode !== 0) return { ...info, note: "Not logged in. Run `codex login` once." };
    return info;
  },

  listModels: async (env) => {
    const found = await probeVersion(findExecutables("codex", env), env);
    if (!found) return FALLBACK_MODELS;
    const result = await runCapture(found.path, ["debug", "models", "--bundled"], {
      env,
      timeoutMs: 15_000,
    });
    if (result.exitCode !== 0) return FALLBACK_MODELS;
    try {
      const models = parseCodexCatalog(result.stdout);
      return models.length > 0 ? models : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  },

  run: async (ctx) => {
    const found = await probeVersion(findExecutables("codex", ctx.env), ctx.env);
    if (!found) {
      ctx.emit({ kind: "error", message: "Codex CLI was not found on PATH." });
      return;
    }
    const state = createCodexState();
    const result = await runCli({
      command: found.path,
      args: buildCodexArgs(ctx),
      cwd: ctx.workdir,
      env: ctx.env,
      stdin: ctx.prompt,
      signal: ctx.signal,
      onStdoutLine: (line) => {
        for (const event of mapCodexLine(line, state)) ctx.emit(event);
      },
    });
    if (state.finished || result.aborted) return;
    if (result.spawnError) {
      ctx.emit({ kind: "error", message: `Could not start Codex: ${result.spawnError}` });
      return;
    }
    if (result.exitCode !== 0) {
      const detail = state.lastError ?? result.stderrTail.join("\n");
      ctx.emit({
        kind: "error",
        message: describeCodexError(
          `Codex exited with code ${result.exitCode ?? result.signal}.${detail ? `\n${detail}` : ""}`,
        ),
      });
    }
  },
};
