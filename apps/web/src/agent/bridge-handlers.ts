import {
  EDITOR_OPS,
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
import type { AgentToolHost } from "./tool-host";

// Loaded on first use: both reach back to bridge-client (requests, saving), which creates these
// handlers, so static imports here would form an import cycle.
const loadBridgeDocuments = () => import("@/persistence/bridge-documents");
const loadBackgroundHost = () => import("./background-host");
type BackgroundHostModule = Awaited<ReturnType<typeof loadBackgroundHost>>;

const EDITOR_OP_NAMES: ReadonlySet<string> = new Set(Object.values(EDITOR_OPS));
import { getActiveRun, setActiveRun } from "./active-run";
import { cancelPendingDecisions } from "./decisions";
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

/** Close out a local agent run: remaining steps resolve according to the final status. */
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
  /** Hosts for projects edited in the background (MCP calls with `project`), per project. */
  const backgroundHosts = new Map<string, { host: AgentToolHost; lastCallAt: number }>();

  /** The background host of a project; a pause in its calls starts a new undo step. */
  const backgroundHostFor = (
    projectId: string,
    projectName: string,
    { createBackgroundToolHost }: BackgroundHostModule,
  ): AgentToolHost => {
    const at = now();
    let entry = backgroundHosts.get(projectId);
    if (!entry) {
      entry = { host: createBackgroundToolHost(projectId, () => MCP_LABEL), lastCallAt: at };
      backgroundHosts.set(projectId, entry);
      agent().appendLog({
        kind: "info",
        text: `${MCP_LABEL} is editing ${projectName} in the background.`,
      });
    } else if (at - entry.lastCallAt > MCP_GROUP_WINDOW_MS) {
      entry.host.newGroup();
    }
    entry.lastCallAt = at;
    return entry.host;
  };

  const handleToolCall = async (message: Extract<BridgeToEditor, { type: "tool_call" }>) => {
    const reply = (content: string, isError: boolean, images?: ToolImage[]) =>
      send({
        type: "tool_result",
        callId: message.callId,
        content,
        isError,
        ...(images && images.length > 0 ? { images } : {}),
      });

    // A call naming a project works on that project, shown or not (it is loaded if needed).
    let background: { id: string; name: string; module: BackgroundHostModule } | null = null;
    if (message.target && message.source.kind === "mcp") {
      const { project } = message.target;
      try {
        const module = await loadBackgroundHost();
        if ((await module.ensureProjectLoaded(project)) === "background") {
          background = { id: project.id, name: project.name, module };
        }
      } catch (error) {
        return void reply(
          `Could not load project ${project.name}: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    }

    // The bridge's file tools: not agent tools, handled by the persistence layer.
    if (EDITOR_OP_NAMES.has(message.tool)) {
      const docs = await loadBridgeDocuments();
      if (message.tool === EDITOR_OPS.loadDocument) {
        const outcome = docs.loadDocumentFromBridge(message.input);
        if (!outcome.isError)
          agent().appendLog({ kind: "info", text: outcome.content.split("\n")[0]! });
        return void reply(outcome.content, outcome.isError);
      }
      if (message.tool === EDITOR_OPS.snapshotDocument) {
        const outcome = background
          ? background.module.snapshotBackground(background.id)
          : docs.snapshotDocumentForBridge();
        return void reply(outcome.content, outcome.isError);
      }
      if (message.tool === EDITOR_OPS.openProject) {
        const outcome = await docs.openProjectForBridge(message.input);
        if (!outcome.isError) agent().appendLog({ kind: "info", text: outcome.content });
        return void reply(outcome.content, outcome.isError);
      }
      if (message.tool === EDITOR_OPS.listTabs) {
        const outcome = docs.listTabsForBridge();
        return void reply(outcome.content, outcome.isError);
      }
      if (message.tool === EDITOR_OPS.switchTab) {
        const outcome = docs.switchTabForBridge(message.input);
        return void reply(outcome.content, outcome.isError);
      }
      const outcome = background
        ? background.module.markBackgroundSaved(background.id, message.input)
        : docs.markSavedFromBridge(message.input);
      return void reply(outcome.content, outcome.isError);
    }

    const spec = findTool(message.tool);
    if (!spec) return void reply(`Unknown tool: ${message.tool}`, true);

    const { source } = message;
    let host = mcpHost;
    if (source.kind === "run") {
      const active = getActiveRun();
      if (!active || active.id !== source.runId || active.backend !== "local") {
        return void reply("No matching active run in the editor.", true);
      }
      host = active.host;
    } else if (source.kind === "mcp" && background) {
      host = backgroundHostFor(background.id, background.name, background.module);
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
    const active = getActiveRun();
    if (!active || active.id !== runId || active.backend !== "local") return;
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
            text: "",
            tool: { name: event.tool, isError: false },
          });
        } else if (event.isError) {
          state.appendLog({
            kind: "tool",
            text: "",
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
        applyDefaultAgent(message.agents);
        agent().set({
          bridge: {
            connected: true,
            claudeCodeAvailable: message.claudeCodeAvailable,
            mcpUrl: message.mcpUrl,
            agents: message.agents,
            projectDir: message.projectDir ?? null,
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
    if (getActiveRun()?.backend === "local") {
      agent().appendLog({ kind: "error", text: "Lost the connection to the local bridge." });
      endRun("failed");
    }
  };

  return { handleMessage, handleClosed };
};
