import { toast } from "sonner";
import { useDocumentStore } from "@/store/use-document-store";
import { canMarkClean, createAutosaveScheduler } from "./autosave-scheduler";
import { serializeDocument } from "./file-format";
import { queryWritePermission, writeToHandle } from "./file-permission";
import { getSaveFilePicker } from "./fs-access";
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

/** True when changes are currently being written to the file in the background. */
export const isFileAutosaveActive = () => {
  const { enabled, status } = useAutosaveStore.getState();
  return (
    enabled &&
    isFileAutosaveSupported() &&
    useFileStore.getState().handle !== null &&
    status !== "paused" &&
    status !== "needs-permission"
  );
};

const writeLatest = async () => {
  const { handle, fileName } = useFileStore.getState();
  const { doc } = useDocumentStore.getState();
  if (!handle || !getIsDirty()) return;
  setStatus("saving");
  await writeToHandle(handle, serializeDocument(doc));
  const now = { doc: useDocumentStore.getState().doc, handle: useFileStore.getState().handle };
  if (canMarkClean({ doc, handle }, now)) {
    useFileStore.getState().markSaved(doc, fileName ?? handle.name, handle);
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
  let lastHandle = useFileStore.getState().handle;

  const unsubDoc = useDocumentStore.subscribe((state, prev) => {
    if (state.doc !== prev.doc && isFileAutosaveActive()) scheduler.notifyChange();
  });

  const unsubFile = useFileStore.subscribe((state) => {
    if (state.handle === lastHandle) return;
    lastHandle = state.handle;
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

  void syncPermission();
  return () => {
    unsubDoc();
    unsubFile();
    unsubSetting();
    scheduler.cancel();
    clearTimeout(savedTimer);
  };
};
