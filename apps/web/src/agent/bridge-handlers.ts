import {
  toolByName,
  type BridgeToEditor,
  type EditorToBridge,
  type LocalAgentId,
  type LocalAgentInfo,
  type RunEvent,
  type ToolImage,
  type ToolSpec,
} from "@pego/agent";
import { pickDefaultAgent } from "./agent-prefs";
import { cancelPendingDecisions } from "./decisions";
import { allRuns, getRun, unregisterRun, type RunEntry } from "./run-registry";
import { createToolHost } from "./tool-host";
import { emptyBridge, useAgentStore } from "./use-agent-store";

/** Consecutive Claude Code (MCP) calls arriving within this window share one undo step. */
export const MCP_GROUP_WINDOW_MS = 2_000;
export const MCP_LABEL = "Claude Code";

export type BridgeHandlerDeps = {
  send: (message: EditorToBridge) => boolean;
  now?: () => number;
  /** Tool lookup (defaults to the shared tool specs; tests inject their own). */
  findTool?: (name: string) => ToolSpec | undefined;
};

const agent = () => useAgentStore.getState();

/** Until the user picks one, use the first ready local agent the bridge reports. */
const applyDefaultAgent = (agents: readonly LocalAgentInfo[]): void => {
  if (agent().explicit) return;
  const id = pickDefaultAgent(agents);
  if (id) agent().set({ backend: "local", localAgentId: id });
};

/** A local (bridge-driven) run the editor knows, or undefined for a stale/foreign id. */
const localRun = (runId: string): RunEntry | undefined => {
  const run = getRun(runId);
  return run?.backend === "local" ? run : undefined;
};

/** Close out a local agent run: remaining steps resolve according to the final status. */
const endRun = (run: RunEntry, status: "done" | "failed" | "cancelled") => {
  const scope = run.host.run;
  for (const step of scope.get()?.steps ?? []) {
    if (step.status === "running") {
      scope.setStepStatus(step.id, status === "done" ? "done" : "failed");
    } else if (step.status === "pending" && status !== "done") {
      scope.setStepStatus(step.id, "skipped");
    }
  }
  scope.set({ status, decision: null, focusIds: [] });
  cancelPendingDecisions(run.id);
  unregisterRun(run.id);
};

/** Cache a `models` reply (even a failed one, so the picker can show the error). */
const applyModels = (agentId: LocalAgentId, models: string[], error?: string) =>
  useAgentStore.setState((state) => ({
    modelsByAgent: {
      ...state.modelsByAgent,
      [agentId]: { models, loading: false, loaded: true, ...(error ? { error } : {}) },
    },
  }));

export const createBridgeHandlers = ({
  send,
  now = Date.now,
  findTool = toolByName,
}: BridgeHandlerDeps) => {
  // Claude Code in a terminal edits through its own host: no run, no "Undo all" range, but the
  // user still sees focus + log activity.
  const mcpHost = createToolHost({
    label: () => MCP_LABEL,
    countTransactions: false,
    focusFromOps: true,
  });
  let lastMcpCallAt = Number.NEGATIVE_INFINITY;

  const handleToolCall = async (message: Extract<BridgeToEditor, { type: "tool_call" }>) => {
    const reply = (content: string, isError: boolean, images?: ToolImage[]) =>
      send({
        type: "tool_result",
        callId: message.callId,
        content,
        isError,
        ...(images && images.length > 0 ? { images } : {}),
      });

    const spec = findTool(message.tool);
    if (!spec) return void reply(`Unknown tool: ${message.tool}`, true);

    const { source } = message;
    let host = mcpHost;
    if (source.kind === "run") {
      const run = localRun(source.runId);
      if (!run) return void reply("No matching active run in the editor.", true);
      host = run.host;
    } else if (source.kind === "mcp") {
      const at = now();
      if (at - lastMcpCallAt > MCP_GROUP_WINDOW_MS) mcpHost.newGroup();
      lastMcpCallAt = at;
    } else {
      return void reply("Unknown tool call source.", true);
    }

    try {
      const result = await spec.run(message.input, host);
      if (source.kind === "mcp") {
        mcpHost.run.appendLog({
          kind: "tool",
          text: "",
          tool: { name: message.tool, isError: result.isError },
        });
      }
      reply(result.content, result.isError, result.images);
    } catch (error) {
      reply(error instanceof Error ? error.message : "tool failed", true);
    }
  };

  const handleRunEvent = (runId: string, event: RunEvent) => {
    // Events of a run the editor no longer tracks (cancelled, reloaded) are dropped.
    const run = localRun(runId);
    if (!run) return;
    const scope = run.host.run;
    if (scope.get()?.status === "planning") scope.set({ status: "running" });
    switch (event.kind) {
      case "text":
        scope.appendLog({ kind: "assistant", text: event.text });
        break;
      case "tool":
        if (event.status === "started") {
          scope.appendLog({
            kind: "tool",
            text: "",
            tool: { name: event.tool, isError: false },
          });
        } else if (event.isError) {
          scope.appendLog({
            kind: "tool",
            text: "",
            tool: { name: event.tool, isError: true },
          });
        }
        break;
      case "usage":
        scope.addUsage({
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
        });
        break;
      case "done":
        endRun(run, "done");
        break;
      case "error":
        scope.appendLog({ kind: "error", text: event.message });
        endRun(run, "failed");
        break;
    }
  };

  const handleMessage = async (message: BridgeToEditor): Promise<void> => {
    switch (message.type) {
      case "welcome":
        applyDefaultAgent(message.agents);
        agent().set({
          bridge: {
            connected: true,
            claudeCodeAvailable: message.claudeCodeAvailable,
            mcpUrl: message.mcpUrl,
            agents: message.agents,
          },
          // A new bridge session may have different CLIs: drop cached model lists.
          modelsByAgent: {},
          agentsRefreshing: false,
        });
        return;
      case "agents":
        applyDefaultAgent(message.agents);
        agent().set({
          bridge: { ...agent().bridge, agents: message.agents },
          agentsRefreshing: false,
        });
        return;
      case "models":
        return applyModels(message.agentId, message.models, message.error);
      case "tool_call":
        return handleToolCall(message);
      case "run_event":
        return handleRunEvent(message.runId, message.event);
    }
  };

  const handleClosed = () => {
    agent().set({ bridge: emptyBridge(), modelsByAgent: {}, agentsRefreshing: false });
    // Every bridge-driven run dies with the connection; in-browser runs keep going.
    for (const run of allRuns()) {
      if (run.backend !== "local") continue;
      run.host.run.appendLog({ kind: "error", text: "Lost the connection to the local bridge." });
      endRun(run, "failed");
    }
  };

  return { handleMessage, handleClosed };
};
