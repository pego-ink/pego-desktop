import { sendToBridge } from "./bridge-client";
import { setActiveRun } from "./active-run";
import { setRunTail } from "./active-run";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

/**
 * Backend "claude-code": the local bridge drives a Claude Agent SDK run. Plan, steps and
 * decisions arrive as tool calls (report_plan, report_step, ask_user) handled by
 * `bridge-handlers`; text, tool activity, usage and completion arrive as `run_event`s.
 */
export const startClaudeCodeRun = (runId: string, prompt: string): void => {
  const agent = useAgentStore.getState();
  agent.beginRun(runId, prompt);
  agent.appendLog({ kind: "user", text: prompt });
  setRunTail(null);

  const { bridge } = agent;
  if (!bridge.connected) {
    agent.appendLog({
      kind: "error",
      text: "The Claude Code bridge is not running. Start it with `bun run bridge`.",
    });
    agent.set({ status: "failed" });
    return;
  }
  if (!bridge.claudeCodeAvailable) {
    agent.appendLog({
      kind: "error",
      text: "The bridge found no local Claude Code login. Run `claude` once to sign in.",
    });
    agent.set({ status: "failed" });
    return;
  }

  setActiveRun({
    id: runId,
    backend: "claude-code",
    controller: new AbortController(),
    host: createToolHost({ onTransaction: setRunTail }),
  });
  if (!sendToBridge({ type: "run_start", runId, prompt })) {
    setActiveRun(null);
    agent.appendLog({ kind: "error", text: "Could not reach the Claude Code bridge." });
    agent.set({ status: "failed" });
  }
};

export const cancelClaudeCodeRun = (runId: string): void => {
  sendToBridge({ type: "run_cancel", runId });
};
