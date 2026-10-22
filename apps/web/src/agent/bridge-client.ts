import {
  BRIDGE_DEFAULT_PORT,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_REPLACED_CLOSE_CODE,
  type BridgeToEditor,
  type EditorToBridge,
} from "@pego/agent";
import { toast } from "sonner";
import { DEFAULT_FILE_NAME } from "@/persistence/file-format";
import { useFileStore } from "@/persistence/use-file-store";
import { createBridgeHandlers } from "./bridge-handlers";

/** The subset of `WebSocket` the client uses (a fake implements it in tests). */
export type SocketLike = {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: { code?: number }) => void) | null;
  onerror: (() => void) | null;
};

export type BridgeClientOptions = {
  url?: string;
  createSocket?: (url: string) => SocketLike;
  documentName?: () => string;
  /** Called for every valid message from the bridge. */
  onMessage: (message: BridgeToEditor) => void;
  onClosed: () => void;
  /** Another editor tab took the bridge. The client stays disconnected until `takeOver`. */
  onReplaced?: () => void;
  /** Reconnect delay for the nth consecutive failure (ms). */
  backoff?: (attempt: number) => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const bridgeUrl = (port = BRIDGE_DEFAULT_PORT) => `ws://127.0.0.1:${port}/editor`;

const defaultBackoff = (attempt: number) => Math.min(1_000 * 2 ** attempt, 30_000);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
        ? (value as unknown as BridgeToEditor)
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
  /** Reconnect after another tab replaced this one (the user picked this tab again). */
  takeOver: () => void;
  isReplaced: () => boolean;
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
  /** Set after another tab replaced this one: no automatic reconnects until `takeOver`. */
  let parked = false;

  const scheduleReconnect = () => {
    if (stopped || parked || timer !== null) return;
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
      if (event?.code === BRIDGE_REPLACED_CLOSE_CODE) {
        // Reconnecting would kick the other tab, which would kick this one back, forever.
        parked = true;
        options.onReplaced?.();
        return;
      }
      scheduleReconnect();
    };
  };

  return {
    start: () => {
      if (!stopped) return;
      stopped = false;
      parked = false;
      attempt = 0;
      connect();
    },
    takeOver: () => {
      if (stopped || !parked) return;
      parked = false;
      attempt = 0;
      connect();
    },
    isReplaced: () => parked,
    stop: () => {
      stopped = true;
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

const SAVE_TIMEOUT_MS = 15_000;
const pendingSaves = new Map<string, (error: string | null) => void>();

/**
 * Ask the bridge to write a document to `path` on disk (File → Save for documents opened
 * through Claude Code's open_document). Rejects when the bridge is not connected or fails.
 */
export const saveFileViaBridge = (path: string, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingSaves.delete(requestId);
      reject(new Error("the Pego bridge did not answer"));
    }, SAVE_TIMEOUT_MS);
    pendingSaves.set(requestId, (error) => {
      clearTimeout(timer);
      pendingSaves.delete(requestId);
      if (error) reject(new Error(error));
      else resolve();
    });
    if (!client?.send({ type: "save_file", requestId, path, text })) {
      pendingSaves.get(requestId)?.(
        "the Pego bridge is not running (start it with bun run bridge)",
      );
    }
  });

/** Send to the bridge if connected. Used by the Claude Code run (`run_start`/`run_cancel`). */
export const sendToBridge = (message: EditorToBridge): boolean => client?.send(message) ?? false;

/**
 * Connect the editor to the local bridge (ws://127.0.0.1:4519/editor). Call once on mount of
 * the app shell, normally through `useBridgeConnection()`. Idempotent; returns a stop function
 * that disconnects and stops reconnecting.
 */
export const startBridgeConnection = (): (() => void) => {
  if (!client) {
    client = createBridgeClient({
      onMessage: (message) => {
        if (message.type === "save_file_result") {
          pendingSaves.get(message.requestId)?.(
            message.ok ? null : (message.error ?? "save failed"),
          );
          return;
        }
        void handlers.handleMessage(message);
      },
      onClosed: handlers.handleClosed,
      onReplaced: () => {
        handlers.handleReplaced();
        toast.info("Claude Code is now connected to another Pego window", {
          description: "Edits from Claude Code go to that window until you switch back.",
          action: { label: "Use this window", onClick: () => takeOverBridge() },
          duration: 15_000,
        });
      },
    });
  }
  client.start();
  const started = client;
  return () => {
    started.stop();
  };
};

/** Make this tab the one Claude Code edits again, after another tab took the bridge. */
export const takeOverBridge = (): void => client?.takeOver();
