import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { RunAttachment, RunEvent } from "@pego/agent";
import { attachmentPromptNote, writeAttachments } from "../attachments";
import { buildChildEnv } from "./env";
import type { AgentAdapter, AgentRunContext } from "./types";

/** Settings files of the user's real CLI installs, which a run must never touch. */
export const GLOBAL_CONFIG_FILES = [
  ".qwen/settings.json",
  ".gemini/settings.json",
  ".cursor/mcp.json",
  ".cursor/cli-config.json",
];

export const checksumGlobalConfigs = async (): Promise<Record<string, string>> => {
  const sums: Record<string, string> = {};
  for (const relative of GLOBAL_CONFIG_FILES) {
    try {
      const data = await readFile(join(homedir(), relative));
      sums[relative] = createHash("sha256").update(data).digest("hex");
    } catch {
      sums[relative] = "absent";
    }
  }
  return sums;
};

export const makeTempDir = (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), `pego-${prefix}-`));

export const writeSettings = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
};

export type SmokeResult = { events: RunEvent[]; workdir: string };

/** Run an adapter once in a throw-away workdir and collect its events. */
export const runAdapter = async (
  adapter: AgentAdapter,
  input: Pick<AgentRunContext, "mcpUrl" | "prompt"> & {
    env?: Record<string, string>;
    model?: string;
    systemPrompt?: string;
    signal?: AbortSignal;
    attachments?: RunAttachment[];
  },
): Promise<SmokeResult> => {
  const workdir = await makeTempDir("run");
  const events: RunEvent[] = [];
  try {
    const attachments = await writeAttachments(workdir, input.attachments ?? []);
    await adapter.run({
      runId: "test-run",
      prompt: `${input.prompt}${attachmentPromptNote(attachments)}`,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(input.model ? { model: input.model } : {}),
      mcpUrl: input.mcpUrl,
      systemPrompt: input.systemPrompt ?? "You are a design agent.",
      workdir,
      env: { ...buildChildEnv(process.env), ...input.env },
      signal: input.signal ?? new AbortController().signal,
      emit: (event) => events.push(event),
    });
    return { events, workdir };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
};
