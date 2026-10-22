import { useEffect } from "react";
import { emptyHistory, loadDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { captureLive, snapshotIsDirty, type DocumentSnapshot } from "@/workspace/live-document";
import {
  anyWorkspaceDirty,
  restoreWorkspaces,
  SCRATCH_ID,
  useWorkspaceStore,
  type SavedWorkspace,
  type Workspace,
} from "@/workspace/use-workspace-store";
import { isTextEditing } from "@/store/use-text-edit-store";
import {
  readAutosave,
  writeAutosave,
  type AutosavedTab,
  type AutosavedWorkspace,
} from "./autosave-db";
import { openFile, saveFile, saveFileAs } from "./file-actions";
import { isFileWriteInFlight, startFileAutosave } from "./file-autosave";
import { getIsDirty, useFileStore } from "./use-file-store";

const AUTOSAVE_DELAY_MS = 800;

/** True while a debounced autosave is scheduled or being written. */
let autosavePending = false;

/** Handles are kept (autosave-db retries without them when the browser cannot clone one). */
const autosavedTab = (state: DocumentSnapshot): AutosavedTab => ({
  doc: state.doc,
  fileName: state.file.fileName,
  handle: state.file.handle,
  bridgePath: state.file.bridgePath,
  dirty: snapshotIsDirty(state),
});

/** A workspace's one document, from its snapshot or (live) from the stores. */
const workspaceTabs = (workspace: Workspace): { tabs: AutosavedTab[]; activeIndex: number } => ({
  tabs: [autosavedTab(workspace.saved ?? captureLive())],
  activeIndex: 0,
});

const writeCurrent = async () => {
  const { workspaces, liveId, view } = useWorkspaceStore.getState();
  const saved: AutosavedWorkspace[] = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    dir: workspace.dir,
    kind: workspace.kind,
    ...workspaceTabs(workspace),
  }));
  const liveIndex = Math.max(
    0,
    workspaces.findIndex((workspace) => workspace.id === liveId),
  );
  const live = captureLive();
  await writeAutosave({
    ...autosavedTab(live),
    tabs: saved[liveIndex]?.tabs,
    activeIndex: saved[liveIndex]?.activeIndex,
    workspaces: saved,
    liveIndex,
    view,
    savedAt: Date.now(),
  });
};

const toSnapshot = (tab: AutosavedTab): DocumentSnapshot | null => {
  // Autosaves written by an older Pego hold an older document version.
  const doc = loadDocument(tab.doc);
  if (!doc) return null;
  return {
    doc,
    history: emptyHistory(),
    selection: [],
    pageId: null,
    camera: useViewportStore.getState().camera,
    file: {
      fileName: tab.fileName,
      handle: tab.handle,
      bridgePath: tab.bridgePath ?? null,
      savedDoc: tab.dirty ? null : doc,
    },
  };
};

/**
 * A workspace's saved document (its active tab; older autosaves kept several tabs per workspace,
 * now each has one document), or null when it is not readable.
 */
const toSavedWorkspace = (stored: AutosavedTab[], activeIndex: number): SavedWorkspace | null => {
  const active = stored[Math.min(Math.max(activeIndex, 0), stored.length - 1)];
  const snapshot = active ? toSnapshot(active) : null;
  if (!snapshot && active) {
    console.warn("autosave: a document was ignored (invalid or from a newer Pego)");
  }
  return snapshot;
};

const restoreAutosave = async () => {
  const record = await readAutosave();
  if (!record) return;
  if (record.workspaces?.length) {
    const saved = record.workspaces.map((workspace) =>
      toSavedWorkspace(workspace.tabs, workspace.activeIndex),
    );
    restoreWorkspaces(
      record.workspaces.map(({ id, name, dir, kind }) => ({ id, name, dir, kind })),
      saved,
      record.liveIndex ?? 0,
      record.view ?? "editor",
    );
    return;
  }
  // Older autosaves: one set of tabs (or one document), restored as scratch.
  const stored: AutosavedTab[] = record.tabs ?? [
    {
      doc: record.doc,
      fileName: record.fileName,
      handle: record.handle,
      bridgePath: record.bridgePath ?? null,
      dirty: record.dirty,
    },
  ];
  const workspace = toSavedWorkspace(stored, record.activeIndex ?? 0);
  if (!workspace) return;
  restoreWorkspaces(
    [{ id: SCRATCH_ID, name: "Scratch", dir: null, kind: "scratch" }],
    [workspace],
    0,
    "editor",
  );
};

const handleShortcut = (event: KeyboardEvent) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || isTextEditing()) return;
  const key = event.key.toLowerCase();
  const action =
    key === "s"
      ? event.shiftKey
        ? saveFileAs
        : saveFile
      : key === "o" && !event.shiftKey
        ? openFile
        : null;
  if (!action) return;
  event.preventDefault();
  void action();
};

const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  // The browser copy covers everything except a pending IndexedDB write or a file write mid-flight.
  const dirty = getIsDirty() || anyWorkspaceDirty();
  if (!((autosavePending || isFileWriteInFlight()) && dirty)) return;
  event.preventDefault();
};

/** Restores the autosave on startup, then autosaves, registers file shortcuts and the unload guard. */
export const usePersistence = () => {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let stopFileAutosave: (() => void) | undefined;

    const schedule = () => {
      autosavePending = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void writeCurrent().finally(() => {
          autosavePending = timer !== undefined;
        });
      }, AUTOSAVE_DELAY_MS);
    };

    void restoreAutosave().then(() => {
      if (cancelled) return;
      const unsubDoc = useDocumentStore.subscribe((s, prev) => {
        if (s.doc !== prev.doc) schedule();
      });
      const unsubFile = useFileStore.subscribe(schedule);
      stopFileAutosave = startFileAutosave();
      const unsubWorkspaces = useWorkspaceStore.subscribe(schedule);
      unsubscribe = () => {
        unsubDoc();
        unsubFile();
        unsubWorkspaces();
      };
    });

    window.addEventListener("keydown", handleShortcut, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe?.();
      stopFileAutosave?.();
      window.removeEventListener("keydown", handleShortcut, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
};
