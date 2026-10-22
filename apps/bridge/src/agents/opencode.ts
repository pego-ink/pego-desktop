import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SDK_SERVER_NAME } from "../config";
import { withApiKeys } from "./env";
import { createOpencodeState, finishOpencodeRun, mapOpencodeLine } from "./opencode-events";
import { extractVersion, findExecutables, probeVersion, runCapture, runCli } from "./process";
import type { AgentAdapter, AgentRunContext } from "./types";

export const OPENCODE_INSTRUCTIONS_FILE = "PEGO_INSTRUCTIONS.md";

/** How opencode exposes Pego's tools; appended to the shared system prompt. */
export const OPENCODE_TOOL_NOTE = [
  "In opencode, Pego's tools are called from the `execute` tool as `await tools.pego.<tool_name>(input)`,",
  "for example `return await tools.pego.get_document({})`. Use only these tools. Never use `fetch` or any",
  'network access, and never try shell or file tools. If a call answers "Unknown tool" right after',
  "startup, retry it once.",
].join(" ");

/**
 * Config handed to opencode through `OPENCODE_CONFIG_CONTENT` (highest-precedence layer, nothing
 * written to the user's config). Pego's MCP server is the only thing allowed: every other tool
 * (bash, edit, read, webfetch, the user's own MCP servers...) is denied by a catch-all rule that
 * the later allow rules override (last matching rule wins). Verified against 2.0.32: with this
 * config `tools.opencode` is empty inside `execute` and the user's other MCP servers are hidden.
 * Known gap: code mode's built-in `fetch` is not governed by permissions in this version.
 */
export const buildOpencodeConfig = (input: {
  mcpUrl: string;
  instructionsPath: string;
}): Record<string, unknown> => ({
  $schema: "https://opencode.ai/config.json",
  autoupdate: false,
  share: "disabled",
  instructions: [input.instructionsPath],
  mcp: { [SDK_SERVER_NAME]: { type: "remote", url: input.mcpUrl, enabled: true } },
  // opencode 2.x reaches MCP tools through its code-mode `execute` tool, so that tool must be
  // allowed; everything it could reach other than Pego's tools stays denied by the catch-all.
  permission: { "*": "deny", execute: "allow", [`${SDK_SERVER_NAME}_*`]: "allow" },
});

/** Arguments for `opencode run`. `--standalone` so our config env applies to a private server. */
export const buildOpencodeArgs = (
  input: Pick<AgentRunContext, "model" | "prompt" | "attachments">,
): string[] => [
  "run",
  "--standalone",
  "--format",
  "json",
  ...(input.model ? ["-m", input.model] : []),
  ...(input.attachments ?? []).flatMap((item) => ["-f", item.path]),
];

/** Env: keys the user's providers may need are kept; project-level config and updates are off. */
export const buildOpencodeEnv = (
  env: Record<string, string>,
  config: Record<string, unknown>,
  source: Record<string, string | undefined> = process.env,
): Record<string, string> => ({
  ...withApiKeys(env, source),
  OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
});

/** `opencode models` prints one `provider/model[#variant]` id per line; ids pass through as is. */
export const parseOpencodeModels = (stdout: string): string[] =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/\s/.test(line));

const findOpencode = (env: Record<string, string>) =>
  probeVersion(findExecutables("opencode", env), env);

export const opencodeAdapter: AgentAdapter = {
  id: "opencode",
  name: "opencode",
  supportsModels: true,

  detect: async (env) => {
    const found = await findOpencode(env);
    if (!found) {
      return { installed: false, note: "opencode was not found. Install it from opencode.ai." };
    }
    const info = { installed: true, path: found.path, version: extractVersion(found.version) };
    const models = await runCapture(found.path, ["models"], { env, timeoutMs: 8000 });
    if (models.exitCode === 0 && parseOpencodeModels(models.stdout).length === 0) {
      return { ...info, note: "No models available. Run `opencode auth login` to add a provider." };
    }
    return info;
  },

  listModels: async (env) => {
    const found = await findOpencode(env);
    if (!found) throw new Error("opencode was not found.");
    const result = await runCapture(found.path, ["models"], { env, timeoutMs: 15_000 });
    if (result.exitCode !== 0) {
      throw new Error(
        `\`opencode models\` failed: ${result.stderr.slice(-200) || result.exitCode}`,
      );
    }
    return parseOpencodeModels(result.stdout);
  },

  run: async (ctx) => {
    const found = await findOpencode(ctx.env);
    if (!found) {
      ctx.emit({ kind: "error", message: "opencode was not found on PATH." });
      return;
    }
    const instructionsPath = join(ctx.workdir, OPENCODE_INSTRUCTIONS_FILE);
    await writeFile(instructionsPath, `${ctx.systemPrompt}\n\n${OPENCODE_TOOL_NOTE}`, "utf8");
    const config = buildOpencodeConfig({ mcpUrl: ctx.mcpUrl, instructionsPath });
    const state = createOpencodeState();
    const result = await runCli({
      command: found.path,
      args: buildOpencodeArgs(ctx),
      cwd: ctx.workdir,
      env: buildOpencodeEnv(ctx.env, config),
      stdin: ctx.prompt,
      signal: ctx.signal,
      onStdoutLine: (line) => {
        for (const event of mapOpencodeLine(line, state)) ctx.emit(event);
      },
    });
    if (result.aborted || state.failed) return;
    if (result.spawnError) {
      ctx.emit({ kind: "error", message: `Could not start opencode: ${result.spawnError}` });
      return;
    }
    if (result.exitCode !== 0) {
      const detail = result.stderrTail.join("\n").slice(-500);
      ctx.emit({
        kind: "error",
        message: `opencode exited with code ${result.exitCode ?? result.signal}.${detail ? `\n${detail}` : ""}`,
      });
      return;
    }
    for (const event of finishOpencodeRun(state)) ctx.emit(event);
  },
};
