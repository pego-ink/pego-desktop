import type { EditorToBridge, LocalAgentId, LocalAgentInfo } from "@pego/agent";
import { sendToBridge } from "./bridge-client";
import { useAgentStore, type ModelsEntry } from "./use-agent-store";

/** Display names used before the bridge reports its own (bridge down or not yet welcomed). */
export const LOCAL_AGENT_NAMES: Record<LocalAgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  qwen: "Qwen Code",
  gemini: "Gemini CLI",
  cursor: "Cursor Agent",
};

/** Ask the bridge to re-detect the installed agent CLIs; the answer arrives as `agents`. */
export const refreshAgents = (
  send: (message: EditorToBridge) => boolean = sendToBridge,
): boolean => {
  const sent = send({ type: "agents_refresh" });
  if (sent) useAgentStore.getState().set({ agentsRefreshing: true });
  return sent;
};

const setEntry = (agentId: LocalAgentId, entry: ModelsEntry) =>
  useAgentStore.setState((state) => ({
    modelsByAgent: { ...state.modelsByAgent, [agentId]: entry },
  }));

/**
 * Fetch the model list for an agent unless it is already cached or loading. `force` retries
 * (e.g. after an error). Answered by a `models` message.
 */
export const requestModels = (
  agentId: LocalAgentId,
  force = false,
  send: (message: EditorToBridge) => boolean = sendToBridge,
): boolean => {
  const current = useAgentStore.getState().modelsByAgent[agentId];
  if (!force && current && (current.loading || (current.loaded && !current.error))) return false;
  if (!send({ type: "models_request", agentId })) return false;
  setEntry(agentId, { models: current?.models ?? [], loading: true, loaded: false });
  return true;
};

export const findAgentInfo = (
  agents: readonly LocalAgentInfo[],
  agentId: LocalAgentId,
): LocalAgentInfo | undefined => agents.find((agent) => agent.id === agentId);
