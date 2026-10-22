import {
  EDITOR_OPS,
  toolByName,
  type BridgeToEditor,
  type EditorToBridge,
  type RunEvent,
  type ToolImage,
  type ToolSpec,
} from "@pego/agent";
import {
  listTabsForBridge,
  loadDocumentFromBridge,
  markSavedFromBridge,
  openProjectForBridge,
  snapshotDocumentForBridge,
  switchTabForBridge,
} from "@/persistence/bridge-documents";
import { getActiveRun, setActiveRun } from "./active-run";
import { cancelPendingDecisions } from "./decisions";
import { createToolHost } from "./tool-host";
import { useAgentStore } from "./use-agent-store";

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

/** Close out a Claude Code run: remaining steps resolve according to the final status. */
const endRun = (status: "done" | "failed" | "cancelled") => {
  const state = agent();
  for (const step of state.steps) {
    if (step.status === "running") {
      state.setStepStatus(step.id, status === "done" ? "done" : "failed");
    } else if (step.status === "pending" && status !== "done") {
      state.setStepStatus(step.id, "skipped");
    }
  }
  state.set({ status, decision: null, focusIds: [] });
  cancelPendingDecisions();
  setActiveRun(null);
};

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

    // The bridge's file tools: not agent tools, handled by the persistence layer.
    if (message.tool === EDITOR_OPS.loadDocument) {
      const outcome = loadDocumentFromBridge(message.input);
      if (!outcome.isError)
        agent().appendLog({ kind: "info", text: outcome.content.split("\n")[0]! });
      return void reply(outcome.content, outcome.isError);
    }
    if (message.tool === EDITOR_OPS.snapshotDocument) {
      const outcome = snapshotDocumentForBridge();
      return void reply(outcome.content, outcome.isError);
    }
    if (message.tool === EDITOR_OPS.openProject) {
      const outcome = await openProjectForBridge(message.input);
      if (!outcome.isError) agent().appendLog({ kind: "info", text: outcome.content });
      return void reply(outcome.content, outcome.isError);
    }
    if (message.tool === EDITOR_OPS.listTabs) {
      const outcome = listTabsForBridge();
      return void reply(outcome.content, outcome.isError);
    }
    if (message.tool === EDITOR_OPS.switchTab) {
      const outcome = switchTabForBridge(message.input);
      return void reply(outcome.content, outcome.isError);
    }
    if (message.tool === EDITOR_OPS.markSaved) {
      const outcome = markSavedFromBridge(message.input);
      return void reply(outcome.content, outcome.isError);
    }

    const spec = findTool(message.tool);
    if (!spec) return void reply(`Unknown tool: ${message.tool}`, true);

    const { source } = message;
    let host = mcpHost;
    if (source.kind === "run") {
      const active = getActiveRun();
      if (!active || active.id !== source.runId || active.backend !== "claude-code") {
        return void reply("No matching active run in the editor.", true);
      }
      host = active.host;
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
        agent().appendLog({
          kind: "tool",
          text: `${MCP_LABEL}: ${message.tool}`,
          tool: { name: message.tool, isError: result.isError },
        });
      }
      reply(result.content, result.isError, result.images);
    } catch (error) {
      reply(error instanceof Error ? error.message : "tool failed", true);
    }
  };

  const handleRunEvent = (runId: string, event: RunEvent) => {
    const active = getActiveRun();
    if (!active || active.id !== runId || active.backend !== "claude-code") return;
    const state = agent();
    if (state.status === "planning") state.set({ status: "running" });
    switch (event.kind) {
      case "text":
        state.appendLog({ kind: "assistant", text: event.text });
        break;
      case "tool":
        if (event.status === "started") {
          state.appendLog({
            kind: "tool",
            text: event.tool,
            tool: { name: event.tool, isError: false },
          });
        } else if (event.isError) {
          state.appendLog({
            kind: "tool",
            text: `${event.tool} failed`,
            tool: { name: event.tool, isError: true },
          });
        }
        break;
      case "usage":
        state.addUsage({
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
        });
        break;
      case "done":
        endRun("done");
        break;
      case "error":
        state.appendLog({ kind: "error", text: event.message });
        endRun("failed");
        break;
    }
  };

  const handleMessage = async (message: BridgeToEditor): Promise<void> => {
    switch (message.type) {
      case "welcome":
        agent().set({
          bridge: {
            connected: true,
            claudeCodeAvailable: message.claudeCodeAvailable,
            mcpUrl: message.mcpUrl,
            replaced: false,
            projectDir: message.projectDir ?? null,
          },
        });
        return;
      case "tool_call":
        return handleToolCall(message);
      case "run_event":
        return handleRunEvent(message.runId, message.event);
    }
  };

  const handleClosed = () => {
    agent().set({
      bridge: { connected: false, claudeCodeAvailable: false, mcpUrl: null, replaced: false },
    });
    if (getActiveRun()?.backend === "claude-code") {
      agent().appendLog({ kind: "error", text: "Lost the connection to the Claude Code bridge." });
      endRun("failed");
    }
  };

  /** Another tab took the bridge (always after `handleClosed`). */
  const handleReplaced = () => {
    agent().set({ bridge: { ...agent().bridge, replaced: true } });
    agent().appendLog({
      kind: "info",
      text: "Another Pego window connected to the bridge; Claude Code now edits that one.",
    });
  };

  return { handleMessage, handleClosed, handleReplaced };
};
