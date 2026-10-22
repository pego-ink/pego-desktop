import { toast } from "sonner";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { isSwapping, snapshotIsDirty } from "@/workspace/live-document";
import {
  findWorkspace,
  markWorkspaceSaved,
  useWorkspaceStore,
  workspaceDocument,
} from "@/workspace/use-workspace-store";
import {
  createAutosaveScheduler,
  canMarkClean,
  type AutosaveScheduler,
} from "./autosave-scheduler";
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
 * the bridge opened it from (bridge projects). Every tab has its own scheduler, so a document that
 * changes in the background (an agent run in another tab) is written too, and a pending write of a
 * tab that was switched away still lands. The header status shows the live tab's. The browser copy
 * in IndexedDB (use-persistence.ts) runs independently and covers everything in between.
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

const liveId = () => useWorkspaceStore.getState().liveId;
/** Scheduler key of the document shown while no tab is open. */
const NO_TAB = "";
const isLive = (workspaceId: string) => (liveId() ?? NO_TAB) === workspaceId;

/** A tab's document and file, live or in the background. */
const documentOf = (workspaceId: string) =>
  workspaceId === NO_TAB && liveId() === null ? null : workspaceDocument(workspaceId);

const tabName = (workspaceId: string) => findWorkspace(workspaceId)?.name ?? "a closed tab";

/** Write a tab's latest state to its source, then mark it saved if nothing changed meanwhile. */
const writeLatest = async (workspaceId: string) => {
  const start = documentOf(workspaceId);
  if (!start || !snapshotIsDirty(start)) return;
  const source = sourceOf(start.file);
  if (source.kind === "none") return;
  if (isLive(workspaceId)) setStatus("saving");
  await writeToSource(source, serializeDocument(start.doc));
  const now = documentOf(workspaceId);
  const clean =
    now !== null &&
    canMarkClean(
      { doc: start.doc, handle: sourceKey(source) },
      { doc: now.doc, handle: sourceKey(sourceOf(now.file)) },
    );
  if (clean) {
    markWorkspaceSaved(workspaceId, start.doc, savedFields(source));
    if (isLive(workspaceId)) showSaved();
  } else if (isLive(workspaceId) && getStatus() === "saving") {
    // Edited during the write: a newer write is already scheduled.
    setStatus("idle");
  }
};

const handleWriteError = (workspaceId: string, error: unknown) => {
  if (isLive(workspaceId)) {
    setStatus("paused");
    toast.error(`Auto save paused: ${errorMessage(error)}. Changes are kept in this browser.`);
    return;
  }
  toast.error(
    `Auto save of "${tabName(workspaceId)}" paused: ${errorMessage(error)}. Changes are kept in this browser.`,
  );
};

const schedulers = new Map<string, AutosaveScheduler>();

const schedulerFor = (workspaceId: string): AutosaveScheduler => {
  let scheduler = schedulers.get(workspaceId);
  if (!scheduler) {
    scheduler = createAutosaveScheduler({
      idleMs: IDLE_MS,
      maxWaitMs: MAX_WAIT_MS,
      write: () => writeLatest(workspaceId),
      onError: (error) => handleWriteError(workspaceId, error),
    });
    schedulers.set(workspaceId, scheduler);
  }
  return scheduler;
};

/** The live tab's scheduler (manual saves, permission and the header status follow it). */
const liveScheduler = () => schedulerFor(liveId() ?? NO_TAB);

/** Runs a manual save in the autosave queue so two writes never overlap. */
export const runExclusiveSave = <T>(job: () => Promise<T>) => liveScheduler().exclusive(job);

/** A manual save succeeded: autosave is healthy again. */
export const noteManualSave = () => {
  liveScheduler().resume();
  showSaved();
};

/** Writes immediately when a debounce is pending; used after permission is regained. */
export const resumeFileAutosave = () => {
  const scheduler = liveScheduler();
  scheduler.resume();
  setStatus("idle");
  if (getIsDirty()) void scheduler.flush();
};

/** Write every tab's pending change now (tests; nothing waits for the debounce). */
export const flushFileAutosaves = async (): Promise<void> => {
  await Promise.all([...schedulers.values()].map((scheduler) => scheduler.flush()));
};

/**
 * Re-checks whether the current source can be written (no prompt): file permission for a local
 * file, the bridge connection for a bridge file.
 */
export const syncPermission = async () => {
  const { enabled } = useAutosaveStore.getState();
  const source = currentSource();
  const scheduler = liveScheduler();
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
    if (sourceKey(currentSource()) !== source.handle || liveScheduler() !== scheduler) return;
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
export const isFileWriteInFlight = () =>
  [...schedulers.values()].some((scheduler) => scheduler.isWriting());

/** Can a background tab's document be written without asking (enabled, writable source)? */
const canWriteInBackground = (file: Parameters<typeof sourceOf>[0]) =>
  useAutosaveStore.getState().enabled && canWrite(sourceOf(file));

/** Wires doc/file/tab/bridge/setting changes to the schedulers. Call after the autosave was restored. */
export const startFileAutosave = () => {
  let lastSource = sourceKey(currentSource());

  // The shown document. A tab swap is not an edit (each tab's pending write stays its own).
  const unsubDoc = useDocumentStore.subscribe((state, prev) => {
    if (isSwapping() || state.doc === prev.doc) return;
    if (isFileAutosaveActive()) liveScheduler().notifyChange();
  });

  const unsubFile = useFileStore.subscribe(() => {
    const key = sourceKey(currentSource());
    if (key === lastSource) return;
    lastSource = key;
    if (isSwapping()) return;
    // New target: forget a previous failure and re-check whether it can be written.
    const scheduler = liveScheduler();
    scheduler.cancel();
    scheduler.resume();
    setStatus("idle");
    void syncPermission();
  });

  // Background tabs: their snapshots change while an agent run edits them.
  const unsubTabs = useWorkspaceStore.subscribe((state, prev) => {
    if (state.liveId !== prev.liveId) {
      lastSource = sourceKey(currentSource());
      setStatus("idle");
      void syncPermission();
    }
    if (state.workspaces === prev.workspaces) return;
    const before = new Map(prev.workspaces.map((workspace) => [workspace.id, workspace]));
    for (const workspace of state.workspaces) {
      const old = before.get(workspace.id)?.saved;
      const saved = workspace.saved;
      if (!saved || !old || saved.doc === old.doc) continue;
      if (canWriteInBackground(saved.file)) schedulerFor(workspace.id).notifyChange();
    }
    // Closed tabs: nothing left to write.
    const open = new Set(state.workspaces.map((workspace) => workspace.id));
    for (const [id, scheduler] of schedulers) {
      if (id === NO_TAB || open.has(id)) continue;
      scheduler.cancel();
      schedulers.delete(id);
    }
  });

  // Bridge files wait for the bridge; a reconnect writes what accumulated meanwhile.
  const unsubBridge = useAgentStore.subscribe((state, prev) => {
    if (state.bridge.connected === prev.bridge.connected) return;
    if (currentSource().kind === "bridge") void syncPermission();
    if (!state.bridge.connected) return;
    for (const workspace of useWorkspaceStore.getState().workspaces) {
      const saved = workspace.saved;
      if (saved && snapshotIsDirty(saved) && canWriteInBackground(saved.file)) {
        schedulerFor(workspace.id).notifyChange();
      }
    }
  });

  const unsubSetting = useAutosaveStore.subscribe((state, prev) => {
    if (state.enabled === prev.enabled) return;
    for (const scheduler of schedulers.values()) {
      scheduler.cancel();
      scheduler.resume();
    }
    setStatus("idle");
    if (state.enabled) void syncPermission();
  });

  void syncPermission();
  return () => {
    unsubDoc();
    unsubFile();
    unsubTabs();
    unsubBridge();
    unsubSetting();
    for (const scheduler of schedulers.values()) scheduler.cancel();
    schedulers.clear();
    clearTimeout(savedTimer);
  };
};
