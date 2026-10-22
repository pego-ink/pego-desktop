import { randomUUID } from "node:crypto";
import { BRIDGE_REPLACED_CLOSE_CODE, type BridgeToEditor, type ToolImage } from "@pego/agent";

export type ToolSource = Extract<BridgeToEditor, { type: "tool_call" }>["source"];
export type ToolOutcome = { content: string; isError: boolean; images?: ToolImage[] };
export type CallTool = (tool: string, input: unknown, source: ToolSource) => Promise<ToolOutcome>;

/** The slice of a WebSocket the hub needs (satisfied by Bun's ServerWebSocket). */
export type EditorSocket = {
  send: (data: string) => unknown;
  close: (code?: number, reason?: string) => void;
};

type Pending = {
  resolve: (outcome: ToolOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  socket: EditorSocket;
};

export const NO_EDITOR_MESSAGE =
  "No Pego editor is connected. Open Pego in the browser (with the bridge running) and try again.";

/**
 * Tracks the single active editor tab and forwards tool calls to it. A tool call never throws:
 * a missing editor, a timeout or a disconnect all resolve to an `isError` outcome.
 */
export const createEditorHub = (options: { toolTimeoutMs: number }) => {
  let active: EditorSocket | null = null;
  let documentName = "";
  const pending = new Map<string, Pending>();

  const settleAllFor = (socket: EditorSocket, message: string) => {
    for (const [callId, entry] of pending) {
      if (entry.socket !== socket) continue;
      clearTimeout(entry.timer);
      pending.delete(callId);
      entry.resolve({ content: message, isError: true });
    }
  };

  /** Make `socket` the active editor; a previous one is closed with a reason. */
  const attach = (socket: EditorSocket, name: string) => {
    const previous = active;
    active = socket;
    documentName = name;
    if (previous && previous !== socket) {
      settleAllFor(previous, "The editor tab was replaced by a newer connection.");
      previous.close(BRIDGE_REPLACED_CLOSE_CODE, "Replaced by a newer editor connection");
    }
  };

  const detach = (socket: EditorSocket) => {
    settleAllFor(socket, "The editor disconnected before answering the tool call.");
    if (active === socket) {
      active = null;
      documentName = "";
    }
  };

  const send = (message: BridgeToEditor): boolean => {
    if (!active) return false;
    try {
      active.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  };

  const callTool: CallTool = (tool, input, source) => {
    const socket = active;
    if (!socket) return Promise.resolve({ content: NO_EDITOR_MESSAGE, isError: true });
    const callId = randomUUID();
    return new Promise<ToolOutcome>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(callId);
        resolve({
          content: `The editor did not answer tool "${tool}" within ${options.toolTimeoutMs / 1000}s.`,
          isError: true,
        });
      }, options.toolTimeoutMs);
      pending.set(callId, { resolve, timer, socket });
      const sent = send({ type: "tool_call", callId, tool, input, source });
      if (!sent) {
        clearTimeout(timer);
        pending.delete(callId);
        resolve({ content: NO_EDITOR_MESSAGE, isError: true });
      }
    });
  };

  /** Deliver a `tool_result`. Only the socket the call was sent to may answer it. */
  const resolveCall = (socket: EditorSocket, callId: string, outcome: ToolOutcome): boolean => {
    const entry = pending.get(callId);
    if (!entry || entry.socket !== socket) return false;
    clearTimeout(entry.timer);
    pending.delete(callId);
    entry.resolve(outcome);
    return true;
  };

  return {
    attach,
    detach,
    send,
    callTool,
    resolveCall,
    isActive: (socket: EditorSocket) => active === socket,
    hasEditor: () => active !== null,
    getDocumentName: () => documentName,
    pendingCount: () => pending.size,
  };
};

export type EditorHub = ReturnType<typeof createEditorHub>;
