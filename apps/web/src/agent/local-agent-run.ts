import type { EditorToBridge } from "@pego/agent";
import { runTargetFor } from "@/workspace/document-target";
import { attachmentNote } from "./attachments";
import { sendToBridge, startBridgeConnection } from "./bridge-client";
import { getRun, registerRun, unregisterRun } from "./run-registry";
import type { RunStartOptions } from "./run";
import { promptWithHistory } from "./sessions/session-context";
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
  options: RunStartOptions & { bridgeWaitMs?: number } = {},
): Promise<void> => {
  const attachments = options.attachments ?? [];
  const waitMs = options.bridgeWaitMs ?? localRunConfig.bridgeWaitMs;
  const agent = useAgentStore.getState();
  const sessionId = options.sessionId ?? agent.visibleSessionId;
  const { localAgentId: agentId, bridge } = agent;
  const info = findAgentInfo(bridge.agents, agentId);
  const name = info?.name ?? LOCAL_AGENT_NAMES[agentId];
  const model = info?.supportsModels === false ? undefined : agent.modelByAgent[agentId];

  const shown = options.displayText?.trim() || prompt;
  agent.beginRun(sessionId, runId, shown);
  // Registered before any wait so a second start in this session is refused meanwhile.
  const host = createToolHost({ runId, attachments, target: runTargetFor(sessionId) });
  const scope = host.run;
  registerRun({
    id: runId,
    sessionId,
    backend: "local",
    controller: new AbortController(),
    host,
    styleId: options.styleId,
    steerMode: info?.steer ?? "restart",
  });
  scope.set({ runLabel: describeRunAgent(name, model) });
  scope.appendLog({
    kind: "user",
    text: shown,
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
    ...(options.steered ? { steered: "delivered" as const } : {}),
  });

  // The CLI loads the skills itself through get_skill; the panel and log keep the user's text.
  const skills = resolveRunSkills(prompt, skillId, options.styleId);
  for (const text of skillLogLines(skills)) scope.appendLog({ kind: "info", text });
  // The images travel in run_start; one line names them so the agent knows they exist.
  const prefix = [skillPromptPrefix(skills), attachmentNote(attachments)]
    .filter(Boolean)
    .join("\n\n");
  const request = promptWithHistory(prompt, options.history);
  const agentPrompt = prefix ? `${prefix}\n\n${request}` : request;

  const fail = (text: string) => {
    unregisterRun(runId);
    scope.appendLog({ kind: "error", text });
    scope.set({ status: "failed" });
  };

  if (!bridge.connected) {
    // The socket may be reconnecting (reload, bridge restart): make sure a connection attempt
    // is running and give it a moment before giving up.
    startBridgeConnection();
    scope.appendLog({ kind: "info", text: "Connecting to the local bridge…" });
    if (!(await waitForBridge(waitMs))) {
      return fail(
        "The local bridge is not running. Start it with `bun run dev` or `bun run bridge`.",
      );
    }
  }
  // Stopped while waiting for the bridge: cancelRun already closed it out.
  if (!getRun(runId)) return;
  if (info && !info.installed) {
    return fail(`${name} is not installed. ${info.note ?? "Install it, then refresh agents."}`);
  }

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
  const reconnected = await waitForBridge(waitMs);
  if (!getRun(runId)) return;
  if (reconnected && send(message)) return;
  fail("Could not reach the local bridge. Reload Pego (⌘R) if this keeps happening.");
};

export const cancelLocalAgentRun = (runId: string): void => {
  sendToBridge({ type: "run_cancel", runId });
};
