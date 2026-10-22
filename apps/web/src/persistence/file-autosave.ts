import { toast } from "sonner";
import { saveFileViaBridge } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { canMarkClean, createAutosaveScheduler } from "./autosave-scheduler";
import { serializeDocument } from "./file-format";
import { queryWritePermission, writeToHandle } from "./file-permission";
import { getSaveFilePicker, type PegoFileHandle } from "./fs-access";
import { useAutosaveStore } from "./use-autosave-store";
import { getIsDirty, useFileStore } from "./use-file-store";

const IDLE_MS = 1500;
const MAX_WAIT_MS = 10_000;
const SAVED_VISIBLE_MS = 2000;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Writing to a real file needs the File System Access API. */
export const isFileAutosaveSupported = () => getSaveFilePicker() !== undefined;

const setStatus = useAutosaveStore.getState().setStatus;
const getStatus = () => useAutosaveStore.getState().status;

let savedTimer: ReturnType<typeof setTimeout> | undefined;

const showSaved = () => {
  setStatus("saved");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    if (getStatus() === "saved") setStatus("idle");
  }, SAVED_VISIBLE_MS);
};

const bridgeConnected = () => useAgentStore.getState().bridge.connected;

/**
 * Where auto save writes: the file handle (File System Access), or else the path on disk the
 * bridge writes (a project's design, a file Claude Code opened). Null when there is none.
 */
const autosaveTarget = (): { handle: PegoFileHandle } | { path: string } | null => {
  const { handle, bridgePath } = useFileStore.getState();
  if (handle) return isFileAutosaveSupported() ? { handle } : null;
  return bridgePath ? { path: bridgePath } : null;
};

/** Identity of the target, to notice it changing while a write is in flight. */
const targetKey = () => useFileStore.getState().handle ?? useFileStore.getState().bridgePath;

/** True when the document has a file auto save can write to right now. */
export const hasAutosaveTarget = () => {
  const target = autosaveTarget();
  return target !== null && ("handle" in target || bridgeConnected());
};

/** True when changes are currently being written to the file in the background. */
export const isFileAutosaveActive = () => {
  const { enabled, status } = useAutosaveStore.getState();
  return enabled && hasAutosaveTarget() && status !== "paused" && status !== "needs-permission";
};

const writeLatest = async () => {
  const target = autosaveTarget();
  const { fileName } = useFileStore.getState();
  const { doc } = useDocumentStore.getState();
  if (!target || !getIsDirty()) return;
  const key = targetKey();
  setStatus("saving");
  const text = serializeDocument(doc);
  if ("handle" in target) await writeToHandle(target.handle, text);
  else await saveFileViaBridge(target.path, text);
  const now = { doc: useDocumentStore.getState().doc, handle: targetKey() };
  if (canMarkClean({ doc, handle: key }, now)) {
    if ("handle" in target) {
      useFileStore.getState().markSaved(doc, fileName ?? target.handle.name, target.handle);
    } else {
      useFileStore
        .getState()
        .markSaved(doc, fileName ?? target.path.split(/[\\/]/).pop() ?? null, null, target.path);
    }
    showSaved();
  } else if (getStatus() === "saving") {
    // Edited during the write: a newer write is already scheduled.
    setStatus("idle");
  }
};

const handleWriteError = (error: unknown) => {
  setStatus("paused");
  toast.error(`Auto save paused: ${errorMessage(error)}. Changes are kept in this browser.`);
};

const scheduler = createAutosaveScheduler({
  idleMs: IDLE_MS,
  maxWaitMs: MAX_WAIT_MS,
  write: writeLatest,
  onError: handleWriteError,
});

/** Runs a manual save in the autosave queue so two writes never overlap. */
export const runExclusiveSave = <T>(job: () => Promise<T>) => scheduler.exclusive(job);

/** A manual save to a file succeeded: autosave is healthy again. */
export const noteManualSave = () => {
  scheduler.resume();
  showSaved();
};

/** Writes immediately when a debounce is pending; used after permission is regained. */
export const resumeFileAutosave = () => {
  scheduler.resume();
  setStatus("idle");
  if (getIsDirty()) void scheduler.flush();
};

/** Re-checks write permission for the current handle (no prompt). */
export const syncPermission = async () => {
  const { enabled } = useAutosaveStore.getState();
  const { handle } = useFileStore.getState();
  if (enabled && !handle && hasAutosaveTarget()) {
    // Bridge paths need no permission: the bridge writes them.
    const status = getStatus();
    if (status === "needs-permission" || status === "paused") setStatus("idle");
    scheduler.resume();
    if (getIsDirty()) scheduler.notifyChange();
    return;
  }
  if (!enabled || !handle || !isFileAutosaveSupported()) {
    setStatus("idle");
    return;
  }
  const permission = await queryWritePermission(handle);
  if (handle !== useFileStore.getState().handle) return;
  if (permission !== "granted") {
    scheduler.pause();
    setStatus("needs-permission");
    return;
  }
  const status = getStatus();
  if (status === "needs-permission" || status === "paused") setStatus("idle");
  scheduler.resume();
  if (getIsDirty()) scheduler.notifyChange();
};

/** True while a file write is running (a close now could interrupt it). */
export const isFileWriteInFlight = () => scheduler.isWriting();

/** Wires doc/file/setting changes to the scheduler. Call after the autosave has been restored. */
export const startFileAutosave = () => {
  let lastTarget = targetKey();

  const unsubDoc = useDocumentStore.subscribe((state, prev) => {
    if (state.doc !== prev.doc && isFileAutosaveActive()) scheduler.notifyChange();
  });

  const unsubFile = useFileStore.subscribe(() => {
    const target = targetKey();
    if (target === lastTarget) return;
    lastTarget = target;
    // New target file: forget a previous failure and re-check its permission.
    scheduler.cancel();
    scheduler.resume();
    setStatus("idle");
    void syncPermission();
  });

  const unsubSetting = useAutosaveStore.subscribe((state, prev) => {
    if (state.enabled === prev.enabled) return;
    scheduler.cancel();
    scheduler.resume();
    setStatus("idle");
    if (state.enabled) void syncPermission();
  });

  // A bridge (re)connect makes project files writable again.
  const unsubBridge = useAgentStore.subscribe((state, prev) => {
    if (state.bridge.connected !== prev.bridge.connected) void syncPermission();
  });

  void syncPermission();
  return () => {
    unsubDoc();
    unsubFile();
    unsubSetting();
    unsubBridge();
    scheduler.cancel();
    clearTimeout(savedTimer);
  };
};
