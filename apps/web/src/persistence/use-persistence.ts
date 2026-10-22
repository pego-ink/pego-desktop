import { useEffect } from "react";
import { createId, emptyHistory, loadDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { captureLive, tabIsDirty, useTabsStore, type TabSnapshot } from "@/tabs/use-tabs-store";
import {
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
import { isDirty } from "./file-format";
import { openFile, saveFile, saveFileAs } from "./file-actions";
import { getIsDirty, useFileStore } from "./use-file-store";

const AUTOSAVE_DELAY_MS = 800;

/** True while a debounced autosave is scheduled or being written. */
let autosavePending = false;

const autosavedTab = (state: TabSnapshot, dirty: boolean, keepHandle: boolean): AutosavedTab => ({
  doc: state.doc,
  fileName: state.file.fileName,
  // Handles may not be cloneable: only the live tab keeps one (autosave-db retries without it).
  handle: keepHandle ? state.file.handle : null,
  bridgePath: state.file.bridgePath,
  dirty,
});

/** Tabs of a workspace from its saved copy, or from the live stores. */
const workspaceTabs = (workspace: Workspace): { tabs: AutosavedTab[]; activeIndex: number } => {
  const source = workspace.saved ?? { ...useTabsStore.getState(), live: captureLive() };
  const tabs = source.tabs.map((tab) => {
    const state = tab.snapshot ?? source.live;
    return autosavedTab(state, isDirty(state.doc, state.file.savedDoc), false);
  });
  return {
    tabs,
    activeIndex: Math.max(
      0,
      source.tabs.findIndex((tab) => tab.id === source.activeId),
    ),
  };
};

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
    ...autosavedTab(live, getIsDirty(), true),
    tabs: saved[liveIndex]?.tabs,
    activeIndex: saved[liveIndex]?.activeIndex,
    workspaces: saved,
    liveIndex,
    view,
    savedAt: Date.now(),
  });
};

const toSnapshot = (tab: AutosavedTab): TabSnapshot | null => {
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

/** A workspace's saved tabs, or null when none of them is readable. */
const toSavedWorkspace = (stored: AutosavedTab[], activeIndex: number): SavedWorkspace | null => {
  const snapshots = stored.map(toSnapshot);
  const valid = snapshots.filter((snapshot): snapshot is TabSnapshot => snapshot !== null);
  if (valid.length < snapshots.length) {
    console.warn("autosave: some tabs were ignored (invalid or from a newer Pego)");
  }
  if (valid.length === 0) return null;
  const index = Math.min(snapshots.slice(0, activeIndex).filter(Boolean).length, valid.length - 1);
  const tabs = valid.map((snapshot, i) => ({
    id: createId(),
    snapshot: i === index ? null : snapshot,
  }));
  return { tabs, activeId: tabs[index]!.id, live: valid[index]! };
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
  if (!(autosavePending && (getIsDirty() || useTabsStore.getState().tabs.some(tabIsDirty)))) return;
  event.preventDefault();
};

/** Restores the autosave on startup, then autosaves, registers file shortcuts and the unload guard. */
export const usePersistence = () => {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

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
      const unsubTabs = useTabsStore.subscribe(schedule);
      const unsubWorkspaces = useWorkspaceStore.subscribe(schedule);
      unsubscribe = () => {
        unsubDoc();
        unsubFile();
        unsubTabs();
        unsubWorkspaces();
      };
    });

    window.addEventListener("keydown", handleShortcut, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener("keydown", handleShortcut, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
};
