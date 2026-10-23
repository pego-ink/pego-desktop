import {
  BRIDGE_PROTOCOL_VERSION,
  EDITOR_OPS,
  type BridgeToEditor,
  type EditorToBridge,
  type RunEvent,
} from "@pego/agent";
import { MAX_MCP_BODY_BYTES, MAX_WS_MESSAGE_BYTES, type BridgeConfig } from "./config";
import { createEditorHub, MAX_EDITOR_SOCKETS, type EditorSocket } from "./editor-hub";
import { createAgentDetector, type AgentDetector } from "./detection";
import type { AgentAdapter } from "./agents/types";
import { handleMcpRequest } from "./mcp";
import { parseEditorMessage } from "./messages";
import { createRunManager, parseRunMcpPath, type RunManager } from "./runs";
import { isHostAllowed, isOriginAllowed } from "./security";
import { writeDocumentFile } from "./files";
import { resolve, sep } from "node:path";
import { listDesignFiles, readProjectFile } from "./project";
import { createProject, listProjects } from "./projects";
import { trashProject } from "./trash";
import { fetchImage, FetchImageError } from "./fetch-image";
import {
  DEFAULT_TOKEN_PATH,
  isExtensionOrigin,
  loadExtensionToken,
  MAX_CAPTURE_BYTES,
  parseCapture,
  tokenMatches,
} from "./extension";

type SocketData = { greeted: boolean };

export type BridgeOptions = BridgeConfig & {
  /** Where the browser extension's pairing code lives (tests use a temp file). */
  extensionTokenPath?: string;
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

type ProjectRequest = Extract<EditorToBridge, { type: "project_request" }>;

/** List the design folder or read one file from it; failures become `ok: false` replies. */
export const answerProjectRequest = async (
  root: string | null,
  request: ProjectRequest,
): Promise<BridgeToEditor> => {
  const base = { type: "project_response" as const, requestId: request.requestId };
  if (!root) return { ...base, ok: false, error: "No design folder in this project.", root };
  try {
    if (request.action === "projects") {
      return { ...base, ok: true, root, projects: await listProjects(root) };
    }
    if (request.action === "create_project") {
      return { ...base, ok: true, root, project: await createProject(root, request.name ?? "") };
    }
    if (request.action === "trash_project") {
      await trashProject(root, await listProjects(root), request.projectId ?? "");
      return { ...base, ok: true, root };
    }
    if (request.action === "list") {
      const dir = request.path ? resolve(request.path) : root;
      if (dir !== root && !dir.startsWith(root + sep)) {
        return { ...base, ok: false, root, error: "Not in the project's design folder." };
      }
      return { ...base, ok: true, root, files: await listDesignFiles(dir) };
    }
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

  // The browser extension's pairing code, read (or created) on first use.
  let extensionToken: Promise<string> | null = null;
  const pairingCode = () =>
    (extensionToken ??= loadExtensionToken(options.extensionTokenPath ?? DEFAULT_TOKEN_PATH));

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

      if (pathname === "/fetch-image") {
        // Images the editor cannot load itself (no CORS on the site). Editor only: a browser page
        // always sends Origin, and only the editor's passes.
        if (!origin || !isOriginAllowed(origin, options.allowedOrigins)) {
          return text(403, "Forbidden: origin not allowed");
        }
        const cors = { "access-control-allow-origin": origin, vary: "Origin" };
        if (request.method !== "GET") {
          return new Response("Method not allowed", { status: 405, headers: cors });
        }
        try {
          const { bytes, type } = await fetchImage(
            new URL(request.url).searchParams.get("url") ?? "",
          );
          return new Response(bytes, {
            headers: {
              ...cors,
              "content-type": type,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        } catch (error) {
          const status = error instanceof FetchImageError ? error.status : 502;
          const message = error instanceof Error ? error.message : "Could not fetch the image.";
          return new Response(message, {
            status,
            headers: { ...cors, "content-type": "text/plain; charset=utf-8" },
          });
        }
      }

      if (pathname === "/extension/token") {
        // The pairing code, for the editor's settings only.
        if (!origin || !isOriginAllowed(origin, options.allowedOrigins)) {
          return text(403, "Forbidden: origin not allowed");
        }
        return Response.json(
          { token: await pairingCode() },
          {
            headers: {
              "access-control-allow-origin": origin,
              vary: "Origin",
              "cache-control": "no-store",
            },
          },
        );
      }

      if (pathname === "/extension/import") {
        // Only a browser extension, and only with the pairing code (see extension.ts).
        if (!isExtensionOrigin(origin)) return text(403, "Forbidden: not a browser extension");
        const cors = {
          "access-control-allow-origin": origin!,
          "access-control-allow-headers": "content-type, x-pego-token",
          "access-control-allow-methods": "POST",
          vary: "Origin",
        };
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        const reply = (status: number, body: string) =>
          new Response(body, {
            status,
            headers: { ...cors, "content-type": "text/plain; charset=utf-8" },
          });
        if (request.method !== "POST") return reply(405, "Method not allowed");
        if (!tokenMatches(request.headers.get("x-pego-token"), await pairingCode())) {
          return reply(
            401,
            "Wrong pairing code. Copy it from Pego: Settings › Agent & Models › Browser extension.",
          );
        }
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_CAPTURE_BYTES) return reply(413, "The capture is larger than 20 MB.");
        const raw = await request.text();
        if (raw.length > MAX_CAPTURE_BYTES) return reply(413, "The capture is larger than 20 MB.");
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return reply(400, "The capture is not JSON.");
        }
        const capture = parseCapture(body);
        if (!capture) return reply(400, "That is not a Pego capture.");
        const outcome = await hub.callTool(EDITOR_OPS.importCapture, capture, {
          kind: "mcp",
          clientName: "Pego browser extension",
        });
        return reply(outcome.isError ? 409 : 200, outcome.content);
      }

      const runToken = parseRunMcpPath(pathname);
      if (pathname === "/mcp" || pathname.startsWith("/mcp/run/")) {
        // Browsers always send Origin; MCP clients (Claude Code) do not. Reject web pages.
        if (origin !== null && !isOriginAllowed(origin, options.allowedOrigins)) {
          return text(403, "Forbidden: origin not allowed");
        }
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > MAX_MCP_BODY_BYTES) return text(413, "Payload too large");
        const designDir = options.designDir ?? null;
        if (pathname === "/mcp") return handleMcpRequest(request, hub.callTool, { designDir });
        // Run-scoped endpoint: the token is the credential and dies with the run. No file tools
        // there: a run edits the document of the editor that started it and must not swap it.
        const run = runToken ? runs.resolveRunToken(runToken) : undefined;
        if (!run) return text(404, "Not found");
        return handleMcpRequest(request, hub.callTool, {
          fixedSource: { kind: "run", runId: run.runId },
        });
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
              projectDir: options.designDir ?? null,
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
        } else if (message.type === "run_cancel") {
          if (hub.getRunOwner(message.runId) !== socket) return;
          runs.cancel(message.runId);
        } else if (message.type === "project_request") {
          void answerProjectRequest(options.designDir ?? null, message).then((reply) =>
            sendTo(ws, reply),
          );
        } else if (message.type === "save_file") {
          const { requestId, path, text: content } = message;
          const fail = (error: string) =>
            sendTo(ws, { type: "save_file_result", requestId, ok: false, error });
          if (!hub.claimFile(resolve(path), socket)) {
            fail(
              "This file is open in another Pego window that was used more recently; " +
                "focus this window to save from it.",
            );
            return;
          }
          void writeDocumentFile(path, content).then(
            () => sendTo(ws, { type: "save_file_result", requestId, ok: true }),
            (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
          );
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
