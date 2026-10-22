import { toast } from "sonner";
import type { PegoDocument } from "@pego/doc";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { setBeforeSwap } from "@/workspace/live-document";
import { markSavedInBackground } from "@/workspace/use-workspace-store";
import { canMarkClean, createAutosaveScheduler } from "./autosave-scheduler";
import {
  savedFields,
  sourceKey,
  sourceOf,
  writeToSource,
  type DocumentSource,
} from "./document-source";
import { serializeDocument } from "./file-format";
import { queryWritePermission } from "./file-permission";
import { getSaveFilePicker } from "./fs-access";
import { useAutosaveStore } from "./use-autosave-store";
import { getIsDirty, useFileStore } from "./use-file-store";

/**
 * Autosave to the document's source (see document-source.ts): its local .pego file, or the file
 * the bridge opened it from (bridge projects). The browser copy in IndexedDB (use-persistence.ts)
 * runs independently and covers everything in between.
 */

const IDLE_MS = 1500;
const MAX_WAIT_MS = 10_000;
const SAVED_VISIBLE_MS = 2000;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Writing to a real local file needs the File System Access API. */
export const isFileAutosaveSupported = () => getSaveFilePicker() !== undefined;

const setStatus = useAutosaveStore.getState().setStatus;
const getStatus = () => useAutosaveStore.getState().status;
const currentSource = (): DocumentSource => sourceOf(useFileStore.getState());
const bridgeConnected = () => useAgentStore.getState().bridge.connected;

let savedTimer: ReturnType<typeof setTimeout> | undefined;

const showSaved = () => {
  setStatus("saved");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    if (getStatus() === "saved") setStatus("idle");
  }, SAVED_VISIBLE_MS);
};

/** The source can take a write right now (supported API / a connected bridge). */
const canWrite = (source: DocumentSource): boolean =>
  source.kind === "file"
    ? isFileAutosaveSupported()
    : source.kind === "bridge"
      ? bridgeConnected()
      : false;

/** True when changes are currently being written to the document's source in the background. */
export const isFileAutosaveActive = () => {
  const { enabled, status } = useAutosaveStore.getState();
  return (
    enabled &&
    canWrite(currentSource()) &&
    status !== "paused" &&
    status !== "needs-permission" &&
    status !== "offline"
  );
};

const markSaved = (doc: PegoDocument, source: DocumentSource) => {
  const { fileName, handle, bridgePath } = savedFields(source);
  useFileStore.getState().markSaved(doc, fileName, handle, bridgePath);
};

const writeLatest = async () => {
  const source = currentSource();
  const { doc } = useDocumentStore.getState();
  if (source.kind === "none" || !getIsDirty()) return;
  setStatus("saving");
  await writeToSource(source, serializeDocument(doc));
  const now = { doc: useDocumentStore.getState().doc, handle: sourceKey(currentSource()) };
  if (canMarkClean({ doc, handle: sourceKey(source) }, now)) {
    markSaved(doc, source);
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

/** A manual save succeeded: autosave is healthy again. */
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

/**
 * Re-checks whether the current source can be written (no prompt): file permission for a local
 * file, the bridge connection for a bridge file.
 */
export const syncPermission = async () => {
  const { enabled } = useAutosaveStore.getState();
  const source = currentSource();
  if (!enabled || source.kind === "none") {
    setStatus("idle");
    return;
  }
  if (source.kind === "bridge") {
    if (!bridgeConnected()) {
      scheduler.pause();
      setStatus("offline");
      return;
    }
  } else {
    if (!isFileAutosaveSupported()) {
      setStatus("idle");
      return;
    }
    const permission = await queryWritePermission(source.handle);
    if (sourceKey(currentSource()) !== source.handle) return;
    if (permission !== "granted") {
      scheduler.pause();
      setStatus("needs-permission");
      return;
    }
  }
  const status = getStatus();
  if (status === "needs-permission" || status === "paused" || status === "offline") {
    setStatus("idle");
  }
  scheduler.resume();
  if (getIsDirty()) scheduler.notifyChange();
};

/** True while a file write is running (a close now could interrupt it). */
export const isFileWriteInFlight = () => scheduler.isWriting();

/**
 * Another workspace's document is about to replace the live one: write a pending autosave of the
 * outgoing document now, to its own source, instead of dropping it. When it lands, the snapshot
 * of that workspace is marked saved (if it still holds exactly that document).
 */
const writeBeforeSwap = () => {
  if (!scheduler.isScheduled() || !isFileAutosaveActive()) return;
  const doc = useDocumentStore.getState().doc;
  const source = currentSource();
  void runExclusiveSave(async () => {
    await writeToSource(source, serializeDocument(doc));
    if (useDocumentStore.getState().doc === doc && sourceKey(currentSource()) === sourceKey(source))
      markSaved(doc, source);
    else markSavedInBackground(doc);
  }).catch((error: unknown) =>
    toast.error(
      `Could not save ${source.kind === "none" ? "the document" : source.fileName}: ${errorMessage(error)}. Changes are kept in this browser.`,
    ),
  );
};

/** Wires doc/file/bridge/setting changes to the scheduler. Call after the autosave was restored. */
export const startFileAutosave = () => {
  let lastSource = sourceKey(currentSource());

  const unsubDoc = useDocumentStore.subscribe((state, prev) => {
    if (state.doc !== prev.doc && isFileAutosaveActive()) scheduler.notifyChange();
  });

  const unsubFile = useFileStore.subscribe(() => {
    const key = sourceKey(currentSource());
    if (key === lastSource) return;
    lastSource = key;
    // New target: forget a previous failure and re-check whether it can be written.
    scheduler.cancel();
    scheduler.resume();
    setStatus("idle");
    void syncPermission();
  });

  // Bridge files wait for the bridge; a reconnect writes what accumulated meanwhile.
  const unsubBridge = useAgentStore.subscribe((state, prev) => {
    if (state.bridge.connected === prev.bridge.connected) return;
    if (currentSource().kind === "bridge") void syncPermission();
  });

  const unsubSetting = useAutosaveStore.subscribe((state, prev) => {
    if (state.enabled === prev.enabled) return;
    scheduler.cancel();
    scheduler.resume();
    setStatus("idle");
    if (state.enabled) void syncPermission();
  });

  setBeforeSwap(writeBeforeSwap);
  void syncPermission();
  return () => {
    unsubDoc();
    unsubFile();
    unsubBridge();
    unsubSetting();
    setBeforeSwap(() => {});
    scheduler.cancel();
    clearTimeout(savedTimer);
  };
};
