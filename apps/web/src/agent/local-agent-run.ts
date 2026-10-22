import type { EditorToBridge, RunAttachment } from "@pego/agent";
import { attachmentNote } from "./attachments";
import { sendToBridge, startBridgeConnection } from "./bridge-client";
import { setActiveRun, setRunTail } from "./active-run";
import { findAgentInfo, LOCAL_AGENT_NAMES } from "./local-agents";
import { resolveRunSkills, skillLogLines, skillPromptPrefix } from "./run-skills";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

/** "Codex · gpt-5" or just "Codex" when the CLI picks its default model. */
export const describeRunAgent = (name: string, model?: string): string =>
  model ? `${name} · ${model}` : name;

/**
 * Backend "local": the bridge drives the chosen coding-agent CLI (Claude Code, Codex, opencode,
 * ...). Plan, steps and decisions arrive as tool calls (report_plan, report_step, ask_user)
 * handled by `bridge-handlers`; text, tool activity, usage and completion arrive as `run_event`s.
 */
/** How long a run waits for the bridge connection to come (back) up before failing. Tests lower it. */
export const localRunConfig = { bridgeWaitMs: 5000 };

/** Resolves true once the store reports a connected bridge, false after `timeoutMs`. */
export const waitForBridge = (timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (useAgentStore.getState().bridge.connected) return resolve(true);
    if (timeoutMs <= 0) return resolve(false);
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
    const unsubscribe = useAgentStore.subscribe((state) => {
      if (!state.bridge.connected) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });

export const startLocalAgentRun = async (
  runId: string,
  prompt: string,
  send: (message: EditorToBridge) => boolean = sendToBridge,
  /** Explicit skill for this run: undefined = auto-detect from the prompt, null = core only. */
  skillId?: string | null,
  options: { bridgeWaitMs?: number; attachments?: readonly RunAttachment[] } = {},
): Promise<void> => {
  const attachments = options.attachments ?? [];
  const waitMs = options.bridgeWaitMs ?? localRunConfig.bridgeWaitMs;
  const agent = useAgentStore.getState();
  const { localAgentId: agentId, bridge } = agent;
  const info = findAgentInfo(bridge.agents, agentId);
  const name = info?.name ?? LOCAL_AGENT_NAMES[agentId];
  const model = info?.supportsModels === false ? undefined : agent.modelByAgent[agentId];

  agent.beginRun(runId, prompt);
  agent.set({ runLabel: describeRunAgent(name, model) });
  agent.appendLog({
    kind: "user",
    text: prompt,
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
  });
  setRunTail(null);

  // The CLI loads the skills itself through get_skill; the panel and log keep the user's text.
  const skills = resolveRunSkills(prompt, skillId);
  for (const text of skillLogLines(skills)) agent.appendLog({ kind: "info", text });
  // The images travel in run_start; one line names them so the agent knows they exist.
  const prefix = [skillPromptPrefix(skills), attachmentNote(attachments)]
    .filter(Boolean)
    .join("\n\n");
  const agentPrompt = prefix ? `${prefix}\n\n${prompt}` : prompt;

  const fail = (text: string) => {
    agent.appendLog({ kind: "error", text });
    agent.set({ status: "failed" });
  };

  if (!bridge.connected) {
    // The socket may be reconnecting (reload, bridge restart): make sure a connection attempt
    // is running and give it a moment before giving up.
    startBridgeConnection();
    agent.appendLog({ kind: "info", text: "Connecting to the local bridge…" });
    if (!(await waitForBridge(waitMs))) {
      return fail(
        "The local bridge is not running. Start it with `bun run dev` or `bun run bridge`.",
      );
    }
  }
  if (info && !info.installed) {
    return fail(`${name} is not installed. ${info.note ?? "Install it, then refresh agents."}`);
  }

  setActiveRun({
    id: runId,
    backend: "local",
    controller: new AbortController(),
    host: createToolHost({ onTransaction: setRunTail, attachments }),
  });
  const message: EditorToBridge = {
    type: "run_start",
    runId,
    prompt: agentPrompt,
    agentId,
    ...(model ? { model } : {}),
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
  };
  if (send(message)) return;
  // The store said "connected" but the socket was not open (e.g. replaced by a reload):
  // restart the connection, wait for it, and try once more.
  startBridgeConnection();
  if ((await waitForBridge(waitMs)) && send(message)) return;
  setActiveRun(null);
  fail("Could not reach the local bridge. Reload Pego (⌘R) if this keeps happening.");
};

export const cancelLocalAgentRun = (runId: string): void => {
  sendToBridge({ type: "run_cancel", runId });
};
