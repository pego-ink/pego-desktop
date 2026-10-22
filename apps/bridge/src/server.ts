import { BRIDGE_PROTOCOL_VERSION, type BridgeToEditor, type RunEvent } from "@pego/agent";
import { MAX_MCP_BODY_BYTES, MAX_WS_MESSAGE_BYTES, type BridgeConfig } from "./config";
import { createEditorHub, type EditorSocket } from "./editor-hub";
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
  const sendRunEvent = (runId: string, event: RunEvent) =>
    void hub.send({ type: "run_event", runId, event });
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
          ws.data.greeted = true;
          hub.attach(socket, message.documentName);
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

        if (!ws.data.greeted || !hub.isActive(socket)) {
          ws.close(1008, "Send hello first");
          return;
        }
        if (message.type === "tool_result") {
          hub.resolveCall(socket, message.callId, {
            content: message.content,
            isError: message.isError,
            ...(message.images?.length ? { images: message.images } : {}),
          });
        } else if (message.type === "run_start") {
          runs.start({
            runId: message.runId,
            prompt: message.prompt,
            agentId: message.agentId,
            ...(message.model ? { model: message.model } : {}),
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
        } else {
          runs.cancel(message.runId);
        }
      },
      close(ws) {
        const socket = ws as unknown as EditorSocket;
        if (hub.isActive(socket)) runs.cancelAll();
        hub.detach(socket);
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
