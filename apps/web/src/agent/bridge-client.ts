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

/** The subset of `WebSocket` the client uses (a fake implements it in tests). */
export type SocketLike = {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
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
  /** Reconnect delay for the nth consecutive failure (ms). */
  backoff?: (attempt: number) => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const bridgeUrl = (port = BRIDGE_DEFAULT_PORT) => `ws://127.0.0.1:${port}/editor`;

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
        ? ({ ...value, agents: sanitizeAgents(value.agents) } as unknown as BridgeToEditor)
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
    current.onclose = () => {
      if (socket !== current) return;
      const wasOpen = open;
      socket = null;
      open = false;
      if (wasOpen) options.onClosed();
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
      onMessage: (message) => void handlers.handleMessage(message),
      onClosed: handlers.handleClosed,
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
