import { randomUUID } from "node:crypto";
import type { BridgeToEditor, ToolImage } from "@pego/agent";

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

/** Most editor sockets (greeted or not) the bridge keeps at once. */
export const MAX_EDITOR_SOCKETS = 8;

/**
 * Tracks every greeted editor tab and forwards tool calls to one of them. The "active" editor
 * is the one most recently greeted or focused; MCP calls from a terminal go there, and when it
 * disconnects the next most recently active one takes over. Run traffic goes only to the socket
 * that started the run (its owner). A tool call never throws: a missing editor, a timeout or a
 * disconnect all resolve to an `isError` outcome.
 */
export const createEditorHub = (options: { toolTimeoutMs: number }) => {
  /** Greeted sockets, least recently active first; the last entry is the active editor. */
  const editors: { socket: EditorSocket; documentName: string }[] = [];
  const runOwners = new Map<string, EditorSocket>();
  /** File path -> the editor that last saved it through the bridge (`save_file`). */
  const fileWriters = new Map<string, EditorSocket>();
  const pending = new Map<string, Pending>();

  const indexOf = (socket: EditorSocket) => editors.findIndex((entry) => entry.socket === socket);
  const activeEntry = () => editors[editors.length - 1];

  const settleAllFor = (socket: EditorSocket, message: string) => {
    for (const [callId, entry] of pending) {
      if (entry.socket !== socket) continue;
      clearTimeout(entry.timer);
      pending.delete(callId);
      entry.resolve({ content: message, isError: true });
    }
  };

  const touch = (socket: EditorSocket) => {
    const index = indexOf(socket);
    if (index < 0) return false;
    const [entry] = editors.splice(index, 1);
    if (entry) editors.push(entry);
    return true;
  };

  /** Register `socket` and make it the active editor. False when the socket cap is reached. */
  const attach = (socket: EditorSocket, name: string): boolean => {
    const index = indexOf(socket);
    if (index < 0 && editors.length >= MAX_EDITOR_SOCKETS) return false;
    if (index >= 0) editors.splice(index, 1);
    editors.push({ socket, documentName: name });
    return true;
  };

  /** Mark `socket` as the active editor (the user focused it). */
  const focus = (socket: EditorSocket): boolean => touch(socket);

  /** Forget `socket`; returns the ids of the runs it owned (their owner entries are dropped). */
  const detach = (socket: EditorSocket): string[] => {
    settleAllFor(socket, "The editor disconnected before answering the tool call.");
    const index = indexOf(socket);
    if (index >= 0) editors.splice(index, 1);
    for (const [path, writer] of fileWriters) if (writer === socket) fileWriters.delete(path);
    const owned: string[] = [];
    for (const [runId, owner] of runOwners) {
      if (owner !== socket) continue;
      runOwners.delete(runId);
      owned.push(runId);
    }
    return owned;
  };

  /**
   * Two editor windows with the same project file open must not overwrite each other's saves.
   * Last focused wins: a save is allowed unless another connected editor saved this file and
   * was focused more recently. The refused editor keeps its changes (its local autosave still
   * runs) and takes the file over as soon as the user focuses it and it saves again.
   */
  const claimFile = (path: string, socket: EditorSocket): boolean => {
    const writer = fileWriters.get(path);
    if (writer && writer !== socket && indexOf(writer) > indexOf(socket)) return false;
    fileWriters.set(path, socket);
    return true;
  };

  const setRunOwner = (runId: string, socket: EditorSocket): boolean => {
    if (runOwners.has(runId) || indexOf(socket) < 0) return false;
    runOwners.set(runId, socket);
    return true;
  };
  const clearRunOwner = (runId: string) => void runOwners.delete(runId);

  const trySend = (socket: EditorSocket, message: BridgeToEditor): boolean => {
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  };

  /** Send a run's `run_event` to the editor that started it; dropped when it is gone. */
  const sendToRunOwner = (runId: string, message: BridgeToEditor): boolean => {
    const owner = runOwners.get(runId);
    return owner ? trySend(owner, message) : false;
  };

  const resolveTarget = (source: ToolSource): EditorSocket | undefined =>
    source.kind === "run" ? runOwners.get(source.runId) : activeEntry()?.socket;

  const callTool: CallTool = (tool, input, source) => {
    const socket = resolveTarget(source);
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
      const sent = trySend(socket, { type: "tool_call", callId, tool, input, source });
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
    focus,
    detach,
    setRunOwner,
    clearRunOwner,
    sendToRunOwner,
    claimFile,
    getRunOwner: (runId: string) => runOwners.get(runId),
    callTool,
    resolveCall,
    isAttached: (socket: EditorSocket) => indexOf(socket) >= 0,
    isActive: (socket: EditorSocket) => activeEntry()?.socket === socket,
    hasEditor: () => editors.length > 0,
    editorCount: () => editors.length,
    getDocumentName: () => activeEntry()?.documentName ?? "",
    pendingCount: () => pending.size,
  };
};

export type EditorHub = ReturnType<typeof createEditorHub>;
