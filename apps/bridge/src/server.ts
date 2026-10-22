import { BRIDGE_PROTOCOL_VERSION, type BridgeToEditor, type RunEvent } from "@pego/agent";
import { MAX_MCP_BODY_BYTES, MAX_WS_MESSAGE_BYTES, type BridgeConfig } from "./config";
import { createEditorHub, MAX_EDITOR_SOCKETS, type EditorSocket } from "./editor-hub";
import { createAgentDetector, type AgentDetector } from "./detection";
import type { AgentAdapter } from "./agents/types";
import { handleMcpRequest } from "./mcp";
import { parseEditorMessage } from "./messages";
import { createRunManager, parseRunMcpPath, type RunManager } from "./runs";
import { isHostAllowed, isOriginAllowed } from "./security";

type SocketData = { greeted: boolean };

export type BridgeOptions = BridgeConfig & {
  /** Overrides for tests. */
  adapters?: AgentAdapter[];
  detector?: AgentDetector;
  runManagerFactory?: (deps: {
    callTool: ReturnType<typeof createEditorHub>["callTool"];
    emit: (runId: string, event: RunEvent) => void;
    mcpOrigin: () => string;
    adapters?: AgentAdapter[];
  }) => RunManager;
};

const sendTo = (ws: { send: (data: string) => unknown }, message: BridgeToEditor): void => {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // the editor went away while we were detecting
  }
};

const text = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export const startBridge = (options: BridgeOptions) => {
  const hub = createEditorHub({ toolTimeoutMs: options.toolTimeoutMs });
  // Only the editor that started a run hears about it; the owner is forgotten once it ends.
  const sendRunEvent = (runId: string, event: RunEvent) => {
    hub.sendToRunOwner(runId, { type: "run_event", runId, event });
    if (event.kind === "done" || event.kind === "error") hub.clearRunOwner(runId);
  };
  let openSockets = 0;
  // Resolved lazily: the port is only known once the server is listening (port 0 in tests).
  const mcpOrigin = () => `http://127.0.0.1:${server.port}`;
  const runs = (options.runManagerFactory ?? createRunManager)({
    callTool: hub.callTool,
    emit: sendRunEvent,
    mcpOrigin,
    ...(options.adapters ? { adapters: options.adapters } : {}),
  });
  const detector =
    options.detector ?? createAgentDetector(options.adapters ? { adapters: options.adapters } : {});

  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: options.port,
    // Tool calls can legitimately take up to the 60s forwarding timeout.
    idleTimeout: 120,
    async fetch(request, srv) {
      if (!isHostAllowed(request.headers.get("host"), srv.port ?? options.port)) {
        return text(403, "Forbidden: invalid Host header");
      }
      const { pathname } = new URL(request.url);
      const origin = request.headers.get("origin");

      if (pathname === "/editor") {
        if (!isOriginAllowed(origin, options.allowedOrigins)) {
          return text(403, "Forbidden: origin not allowed");
        }
        if (openSockets >= MAX_EDITOR_SOCKETS) {
          return text(503, "Too many editor connections");
        }
        if (srv.upgrade(request, { data: { greeted: false } })) return undefined;
        return text(426, "Upgrade Required");
      }

      const runToken = parseRunMcpPath(pathname);
      if (pathname === "/mcp" || pathname.startsWith("/mcp/run/")) {
        // Browsers always send Origin; MCP clients (Claude Code) do not. Reject web pages.
        if (origin !== null && !isOriginAllowed(origin, options.allowedOrigins)) {
          return text(403, "Forbidden: origin not allowed");
        }
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_MCP_BODY_BYTES) return text(413, "Payload too large");
        if (pathname === "/mcp") return handleMcpRequest(request, hub.callTool);
        // Run-scoped endpoint: the token is the credential and dies with the run.
        const run = runToken ? runs.resolveRunToken(runToken) : undefined;
        if (!run) return text(404, "Not found");
        return handleMcpRequest(request, hub.callTool, { kind: "run", runId: run.runId });
      }

      return text(404, "Not found");
    },
    websocket: {
      maxPayloadLength: MAX_WS_MESSAGE_BYTES,
      idleTimeout: 120,
      message(ws, raw) {
        const socket = ws as unknown as EditorSocket;
        const parsed = parseEditorMessage(raw);
        if (!parsed.ok) {
          ws.close(1008, parsed.error);
          return;
        }
        const message = parsed.message;

        if (message.type === "hello") {
          if (message.protocol !== BRIDGE_PROTOCOL_VERSION) {
            ws.close(
              4001,
              `Protocol mismatch: bridge speaks v${BRIDGE_PROTOCOL_VERSION}, editor sent v${message.protocol}. Reload Pego to update the editor.`,
            );
            return;
          }
          if (!hub.attach(socket, message.documentName)) {
            ws.close(1013, `Too many editor connections (max ${MAX_EDITOR_SOCKETS})`);
            return;
          }
          ws.data.greeted = true;
          void detector.detectAll().then((agents) => {
            const welcome: BridgeToEditor = {
              type: "welcome",
              protocol: BRIDGE_PROTOCOL_VERSION,
              claudeCodeAvailable: agents.some((a) => a.id === "claude-code" && a.installed),
              mcpUrl: `http://127.0.0.1:${server.port}/mcp`,
              agents,
            };
            sendTo(ws, welcome);
          });
          return;
        }

        if (!ws.data.greeted || !hub.isAttached(socket)) {
          ws.close(1008, "Send hello first");
          return;
        }
        if (message.type === "tool_result") {
          hub.resolveCall(socket, message.callId, {
            content: message.content,
            isError: message.isError,
            ...(message.images?.length ? { images: message.images } : {}),
          });
        } else if (message.type === "focus") {
          hub.focus(socket);
        } else if (message.type === "run_start") {
          if (!hub.setRunOwner(message.runId, socket)) {
            sendTo(ws, {
              type: "run_event",
              runId: message.runId,
              event: { kind: "error", message: "A run with this id is already in progress." },
            });
            return;
          }
          runs.start({
            runId: message.runId,
            prompt: message.prompt,
            agentId: message.agentId,
            ...(message.model ? { model: message.model } : {}),
            ...(message.attachments?.length ? { attachments: message.attachments } : {}),
          });
        } else if (message.type === "run_steer") {
          const { runId } = message;
          // Only the owner may steer; a finished or foreign run is ignored.
          if (hub.getRunOwner(runId) !== socket) {
            console.debug(`run_steer ignored: no run ${runId} owned by this editor`);
            return;
          }
          void runs
            .steer(runId, {
              text: message.text,
              ...(message.attachments?.length ? { attachments: message.attachments } : {}),
            })
            .then((result) => {
              if (result === "unknown") {
                console.debug(`run_steer ignored: run ${runId} is not live`);
                return;
              }
              // The editor restarts non-native agents itself and never sends them run_steer. No
              // run_event here: the editor treats an "error" event as the end of the run.
              if (result === "unsupported") {
                console.debug(`run_steer ignored: agent of run ${runId} has no native steer`);
              }
            });
        } else if (message.type === "agents_refresh") {
          void detector.detectAll(true).then((agents) => sendTo(ws, { type: "agents", agents }));
        } else if (message.type === "models_request") {
          const { agentId } = message;
          void detector
            .listModels(agentId)
            .then(({ models, error }) =>
              sendTo(ws, { type: "models", agentId, models, ...(error ? { error } : {}) }),
            );
        } else if (hub.getRunOwner(message.runId) === socket) {
          runs.cancel(message.runId);
        }
      },
      open() {
        openSockets += 1;
      },
      close(ws) {
        openSockets = Math.max(0, openSockets - 1);
        const socket = ws as unknown as EditorSocket;
        // Cancel only the runs this editor started; other editors' runs carry on.
        for (const runId of hub.detach(socket)) runs.cancel(runId);
      },
    },
  });

  const port = server.port ?? options.port;
  return {
    port,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    hub,
    runs,
    // Not awaited: Bun's `stop(true)` can stay pending on sockets the server already closed.
    stop: () => {
      runs.cancelAll();
      void server.stop(true);
    },
  };
};

export type Bridge = ReturnType<typeof startBridge>;
