import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeToEditor,
  type EditorToBridge,
  type RunEvent,
} from "@pego/agent";
import { MAX_MCP_BODY_BYTES, MAX_WS_MESSAGE_BYTES, type BridgeConfig } from "./config";
import { createEditorHub, type EditorSocket } from "./editor-hub";
import { isClaudeCodeAvailable } from "./claude-code";
import { handleMcpRequest } from "./mcp";
import { parseEditorMessage } from "./messages";
import { createRunManager, type RunManager } from "./runs";
import { isHostAllowed, isOriginAllowed } from "./security";
import { writeDocumentFile } from "./files";
import { listDesignFiles, readProjectFile } from "./project";

type SocketData = { greeted: boolean };

export type BridgeOptions = BridgeConfig & {
  /** Overrides for tests. */
  claudeCodeAvailable?: () => boolean;
  runManagerFactory?: (deps: {
    callTool: ReturnType<typeof createEditorHub>["callTool"];
    emit: (runId: string, event: RunEvent) => void;
  }) => RunManager;
};

const text = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

type ProjectRequest = Extract<EditorToBridge, { type: "project_request" }>;

/** List the design folder or read one file from it; failures become `ok: false` replies. */
export const answerProjectRequest = async (
  root: string | null,
  request: ProjectRequest,
): Promise<BridgeToEditor> => {
  const base = { type: "project_response" as const, requestId: request.requestId };
  if (!root) return { ...base, ok: false, error: "No design folder in this project.", root };
  try {
    if (request.action === "list")
      return { ...base, ok: true, root, files: await listDesignFiles(root) };
    if (!request.path) return { ...base, ok: false, root, error: "Missing path." };
    return { ...base, ok: true, root, text: await readProjectFile(root, request.path) };
  } catch (error) {
    return {
      ...base,
      ok: false,
      root,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const startBridge = (options: BridgeOptions) => {
  const hub = createEditorHub({ toolTimeoutMs: options.toolTimeoutMs });
  const sendRunEvent = (runId: string, event: RunEvent) =>
    void hub.send({ type: "run_event", runId, event });
  const runs = (options.runManagerFactory ?? createRunManager)({
    callTool: hub.callTool,
    emit: sendRunEvent,
  });
  const checkClaude = options.claudeCodeAvailable ?? isClaudeCodeAvailable;

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

      if (pathname === "/mcp") {
        // Browsers always send Origin; MCP clients (Claude Code) do not. Reject web pages.
        if (origin !== null && !isOriginAllowed(origin, options.allowedOrigins)) {
          return text(403, "Forbidden: origin not allowed");
        }
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_MCP_BODY_BYTES) return text(413, "Payload too large");
        return handleMcpRequest(request, hub.callTool, options.designDir ?? null);
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
          const welcome: BridgeToEditor = {
            type: "welcome",
            protocol: BRIDGE_PROTOCOL_VERSION,
            claudeCodeAvailable: checkClaude(),
            mcpUrl: `http://127.0.0.1:${server.port}/mcp`,
            projectDir: options.designDir ?? null,
          };
          ws.send(JSON.stringify(welcome));
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
          runs.start(message.runId, message.prompt);
        } else if (message.type === "run_cancel") {
          runs.cancel(message.runId);
        } else if (message.type === "project_request") {
          void answerProjectRequest(options.designDir ?? null, message).then((reply) =>
            ws.send(JSON.stringify(reply)),
          );
        } else {
          const { requestId, path, text: content } = message;
          void writeDocumentFile(path, content).then(
            () => ws.send(JSON.stringify({ type: "save_file_result", requestId, ok: true })),
            (error: unknown) =>
              ws.send(
                JSON.stringify({
                  type: "save_file_result",
                  requestId,
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                } satisfies BridgeToEditor),
              ),
          );
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
