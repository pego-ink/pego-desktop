import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeToEditor,
  type EditorToBridge,
  type LocalAgentInfo,
} from "@pego/agent";
import { isLocalAgentId } from "./agent-prefs";
import { DEFAULT_FILE_NAME } from "@/persistence/file-format";
import { useFileStore } from "@/persistence/use-file-store";
import { createBridgeHandlers } from "./bridge-handlers";
import { useAgentStore } from "./use-agent-store";

/** The subset of `WebSocket` the client uses (a fake implements it in tests). */
export type SocketLike = {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null;
  onerror: (() => void) | null;
};

/** The slice of `window` / `document` used to detect focus (fakes implement it in tests). */
export type EventTargetLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type BridgeClientOptions = {
  /** Where `focus` events come from (default: `window`, when it exists). */
  windowTarget?: EventTargetLike | null;
  /** Where `visibilitychange` events come from (default: `document`, when it exists). */
  documentTarget?: (EventTargetLike & { visibilityState?: string }) | null;
  url?: string;
  createSocket?: (url: string) => SocketLike;
  documentName?: () => string;
  /** Called for every valid message from the bridge. */
  onMessage: (message: BridgeToEditor) => void;
  onClosed: () => void;
  /** The bridge refused this editor (another Pego version is listening); it keeps retrying. */
  onRejected?: (reason: string) => void;
  /** Reconnect delay for the nth consecutive failure (ms). */
  backoff?: (attempt: number) => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** `?bridge=4599` in the page URL connects to a bridge on another port (tests, a second checkout). */
const bridgePortFromLocation = (): number => {
  if (typeof location === "undefined") return BRIDGE_DEFAULT_PORT;
  const port = Number(new URLSearchParams(location.search).get("bridge"));
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : BRIDGE_DEFAULT_PORT;
};

/** Close code the bridge sends when the editor speaks another protocol version. */
const BRIDGE_PROTOCOL_MISMATCH_CODE = 4001;

export const bridgeUrl = (port = bridgePortFromLocation()) => `ws://127.0.0.1:${port}/editor`;

const defaultBackoff = (attempt: number) => Math.min(1_000 * 2 ** attempt, 30_000);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAgentInfo = (value: unknown): value is LocalAgentInfo =>
  isRecord(value) &&
  isLocalAgentId(value.id) &&
  typeof value.name === "string" &&
  typeof value.installed === "boolean" &&
  typeof value.supportsModels === "boolean";

/** Keep only well-formed agent entries (unknown agent ids are dropped). */
const sanitizeAgents = (value: unknown): LocalAgentInfo[] =>
  Array.isArray(value) ? value.filter(isAgentInfo) : [];

/**
 * Parse and shape-check one bridge frame. The bridge is a local process, but its frames still
 * cross a trust boundary, so anything malformed is dropped rather than trusted.
 */
export const parseBridgeMessage = (data: unknown): BridgeToEditor | null => {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "welcome":
      return typeof value.claudeCodeAvailable === "boolean" && typeof value.mcpUrl === "string"
        ? ({
            ...value,
            agents: sanitizeAgents(value.agents),
            projectDir: typeof value.projectDir === "string" ? value.projectDir : null,
          } as unknown as BridgeToEditor)
        : null;
    case "agents":
      return Array.isArray(value.agents)
        ? ({ type: "agents", agents: sanitizeAgents(value.agents) } satisfies BridgeToEditor)
        : null;
    case "models":
      return isLocalAgentId(value.agentId) &&
        Array.isArray(value.models) &&
        value.models.every((model) => typeof model === "string")
        ? ({
            type: "models",
            agentId: value.agentId,
            models: value.models as string[],
            ...(typeof value.error === "string" ? { error: value.error } : {}),
          } satisfies BridgeToEditor)
        : null;
    case "tool_call":
      return typeof value.callId === "string" &&
        typeof value.tool === "string" &&
        isRecord(value.source)
        ? (value as unknown as BridgeToEditor)
        : null;
    case "run_event":
      return typeof value.runId === "string" && isRecord(value.event)
        ? (value as unknown as BridgeToEditor)
        : null;
    case "project_response":
    case "save_file_result":
      return typeof value.requestId === "string" && typeof value.ok === "boolean"
        ? (value as unknown as BridgeToEditor)
        : null;
    default:
      return null;
  }
};

export type BridgeClient = {
  start: () => void;
  stop: () => void;
  /** False when the socket is not open (message dropped). */
  send: (message: EditorToBridge) => boolean;
  isOpen: () => boolean;
};

/**
 * WebSocket client for the local bridge. Quiet when the bridge is not running: it just retries
 * with exponential backoff (browsers log failed WebSocket attempts themselves; nothing here does).
 */
export const createBridgeClient = (options: BridgeClientOptions): BridgeClient => {
  const url = options.url ?? bridgeUrl();
  const createSocket =
    options.createSocket ?? ((target: string) => new WebSocket(target) as unknown as SocketLike);
  const backoff = options.backoff ?? defaultBackoff;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));

  let socket: SocketLike | null = null;
  let open = false;
  let stopped = true;
  let attempt = 0;
  let timer: unknown = null;

  const windowTarget =
    options.windowTarget !== undefined
      ? options.windowTarget
      : typeof window === "undefined"
        ? null
        : window;
  const documentTarget =
    options.documentTarget !== undefined
      ? options.documentTarget
      : typeof document === "undefined"
        ? null
        : document;

  /** Tell the bridge this editor is now the one the user is looking at. */
  const announceFocus = () => {
    if (!socket || !open) return;
    socket.send(JSON.stringify({ type: "focus" } satisfies EditorToBridge));
  };
  const onVisibility = () => {
    if (documentTarget?.visibilityState === "visible") announceFocus();
  };

  const scheduleReconnect = () => {
    if (stopped || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      connect();
    }, backoff(attempt++));
  };

  const connect = () => {
    if (stopped) return;
    let current: SocketLike;
    try {
      current = createSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = current;
    current.onopen = () => {
      if (socket !== current) return;
      open = true;
      attempt = 0;
      const documentName =
        options.documentName?.() ?? useFileStore.getState().fileName ?? DEFAULT_FILE_NAME;
      current.send(
        JSON.stringify({
          type: "hello",
          protocol: BRIDGE_PROTOCOL_VERSION,
          documentName,
        } satisfies EditorToBridge),
      );
    };
    current.onmessage = (event) => {
      if (socket !== current) return;
      const message = parseBridgeMessage(event.data);
      if (message) options.onMessage(message);
    };
    current.onerror = () => {
      // `onclose` always follows; reconnect handling lives there.
    };
    current.onclose = (event) => {
      if (socket !== current) return;
      const wasOpen = open;
      socket = null;
      open = false;
      if (wasOpen) options.onClosed();
      if (event?.code === BRIDGE_PROTOCOL_MISMATCH_CODE) {
        options.onRejected?.(event.reason || "The bridge speaks another protocol version.");
      }
      scheduleReconnect();
    };
  };

  return {
    start: () => {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      windowTarget?.addEventListener("focus", announceFocus);
      documentTarget?.addEventListener("visibilitychange", onVisibility);
      connect();
    },
    stop: () => {
      stopped = true;
      windowTarget?.removeEventListener("focus", announceFocus);
      documentTarget?.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) clearTimer(timer);
      timer = null;
      const current = socket;
      const wasOpen = open;
      socket = null;
      open = false;
      current?.close();
      if (wasOpen) options.onClosed();
    },
    send: (message) => {
      if (!socket || !open) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    isOpen: () => open,
  };
};

// ---- app singleton -------------------------------------------------------------------------

let client: BridgeClient | null = null;
const handlers = createBridgeHandlers({ send: (message) => client?.send(message) ?? false });

const REQUEST_TIMEOUT_MS = 15_000;
const OFFLINE =
  "the Pego bridge is not running (start it with bun run bridge, or open the desktop app)";
const pendingSaves = new Map<string, (error: string | null) => void>();

/**
 * Ask the bridge to write a document to `path` on disk (a project's design, or a file Claude
 * Code opened). Rejects when the bridge is not connected or the write fails.
 */
export const saveFileViaBridge = (path: string, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingSaves.delete(requestId);
      reject(new Error("the Pego bridge did not answer"));
    }, REQUEST_TIMEOUT_MS);
    pendingSaves.set(requestId, (error) => {
      clearTimeout(timer);
      pendingSaves.delete(requestId);
      if (error) reject(new Error(error));
      else resolve();
    });
    if (!client?.send({ type: "save_file", requestId, path, text })) {
      pendingSaves.get(requestId)?.(OFFLINE);
    }
  });

type ProjectResponse = Extract<BridgeToEditor, { type: "project_response" }>;
const pendingProject = new Map<string, (response: ProjectResponse) => void>();

/** Ask the bridge for projects, the design folder listing or one file's text. Rejects when offline. */
export const requestProject = (
  action: "list" | "read" | "projects" | "create_project",
  path?: string,
  name?: string,
): Promise<ProjectResponse> =>
  new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingProject.delete(requestId);
      reject(new Error("the Pego bridge did not answer"));
    }, REQUEST_TIMEOUT_MS);
    pendingProject.set(requestId, (response) => {
      clearTimeout(timer);
      pendingProject.delete(requestId);
      if (response.ok) resolve(response);
      else reject(new Error(response.error ?? "request failed"));
    });
    const sent = client?.send({
      type: "project_request",
      requestId,
      action,
      ...(path === undefined ? {} : { path }),
      ...(name === undefined ? {} : { name }),
    });
    if (!sent) {
      clearTimeout(timer);
      pendingProject.delete(requestId);
      reject(new Error(OFFLINE));
    }
  });

/** Replies to `save_file` / `project_request` settle their promise; anything else goes on. */
const settleRequest = (message: BridgeToEditor): boolean => {
  if (message.type === "project_response") {
    pendingProject.get(message.requestId)?.(message);
    return true;
  }
  if (message.type === "save_file_result") {
    pendingSaves.get(message.requestId)?.(message.ok ? null : (message.error ?? "save failed"));
    return true;
  }
  return false;
};

/** Send to the bridge if connected. Used by the local agent run (`run_start`/`run_cancel`) and agent/model requests. */
export const sendToBridge = (message: EditorToBridge): boolean => client?.send(message) ?? false;

/**
 * Connect the editor to the local bridge (ws://127.0.0.1:4519/editor). Call once on mount of
 * the app shell, normally through `useBridgeConnection()`. Idempotent; returns a stop function
 * that disconnects and stops reconnecting.
 */
// Dev hot reload re-runs this module with a fresh `client`; close the old socket first so
// only one connection per page talks to the bridge.
import.meta.hot?.dispose((data: { reconnect?: boolean }) => {
  data.reconnect = client !== null;
  client?.stop();
  client = null;
});

export const startBridgeConnection = (): (() => void) => {
  if (!client) {
    client = createBridgeClient({
      onMessage: (message) => {
        if (!settleRequest(message)) void handlers.handleMessage(message);
      },
      onClosed: handlers.handleClosed,
      onRejected: (reason) =>
        useAgentStore.setState((state) => ({
          bridge: { ...state.bridge, rejectedReason: reason },
        })),
    });
  }
  client.start();
  const started = client;
  return () => {
    started.stop();
  };
};

// After a hot reload replaced this module, reopen the connection right away so the panel and
// `sendToBridge` use the same live socket (the app's mount effect does not run again).
if ((import.meta.hot?.data as { reconnect?: boolean } | undefined)?.reconnect) {
  startBridgeConnection();
}
