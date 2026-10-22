import type { EditorToBridge } from "@pego/agent";
import { sendToBridge } from "./bridge-client";
import { setActiveRun, setRunTail } from "./active-run";
import { findAgentInfo, LOCAL_AGENT_NAMES } from "./local-agents";
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
export const startLocalAgentRun = (
  runId: string,
  prompt: string,
  send: (message: EditorToBridge) => boolean = sendToBridge,
): void => {
  const agent = useAgentStore.getState();
  const { localAgentId: agentId, bridge } = agent;
  const info = findAgentInfo(bridge.agents, agentId);
  const name = info?.name ?? LOCAL_AGENT_NAMES[agentId];
  const model = info?.supportsModels === false ? undefined : agent.modelByAgent[agentId];

  agent.beginRun(runId, prompt);
  agent.set({ runLabel: describeRunAgent(name, model) });
  agent.appendLog({ kind: "user", text: prompt });
  setRunTail(null);

  const fail = (text: string) => {
    agent.appendLog({ kind: "error", text });
    agent.set({ status: "failed" });
  };

  if (!bridge.connected) {
    return fail("The local bridge is not running. Start it with `bun run bridge`.");
  }
  if (info && !info.installed) {
    return fail(`${name} is not installed. ${info.note ?? "Install it, then refresh agents."}`);
  }

  setActiveRun({
    id: runId,
    backend: "local",
    controller: new AbortController(),
    host: createToolHost({ onTransaction: setRunTail }),
  });
  if (!send({ type: "run_start", runId, prompt, agentId, ...(model ? { model } : {}) })) {
    setActiveRun(null);
    fail("Could not reach the local bridge.");
  }
};

export const cancelLocalAgentRun = (runId: string): void => {
  sendToBridge({ type: "run_cancel", runId });
};
