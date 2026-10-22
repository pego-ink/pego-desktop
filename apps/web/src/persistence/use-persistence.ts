import { useEffect } from "react";
import { emptyHistory, loadDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import {
  restoreTabs,
  tabIsDirty,
  tabState,
  useTabsStore,
  type TabSnapshot,
} from "@/tabs/use-tabs-store";
import { isTextEditing } from "@/store/use-text-edit-store";
import { readAutosave, writeAutosave, type AutosavedTab } from "./autosave-db";
import { openFile, saveFile, saveFileAs } from "./file-actions";
import { getIsDirty, useFileStore } from "./use-file-store";

const AUTOSAVE_DELAY_MS = 800;

/** True while a debounced autosave is scheduled or being written. */
let autosavePending = false;

const writeCurrent = async () => {
  const { tabs, activeId } = useTabsStore.getState();
  const saved = tabs.map((tab): AutosavedTab => {
    const state = tabState(tab);
    return {
      doc: state.doc,
      fileName: state.file.fileName,
      handle: state.file.handle,
      bridgePath: state.file.bridgePath,
      dirty: tabIsDirty(tab),
    };
  });
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const active = saved[activeIndex]!;
  // Handles may not be cloneable: autosave-db retries without the active one; drop the rest.
  await writeAutosave({
    ...active,
    tabs: saved.map((tab, i) => (i === activeIndex ? tab : { ...tab, handle: null })),
    activeIndex,
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

const restoreAutosave = async () => {
  const record = await readAutosave();
  if (!record) return;
  const stored: AutosavedTab[] = record.tabs ?? [
    {
      doc: record.doc,
      fileName: record.fileName,
      handle: record.handle,
      bridgePath: record.bridgePath ?? null,
      dirty: record.dirty,
    },
  ];
  const snapshots = stored.map(toSnapshot);
  const valid = snapshots.filter((snapshot): snapshot is TabSnapshot => snapshot !== null);
  if (valid.length < snapshots.length) {
    console.warn("autosave: some tabs were ignored (invalid or from a newer Pego)");
  }
  if (valid.length === 0) return;
  const activeIndex = snapshots.slice(0, record.activeIndex ?? 0).filter(Boolean).length;
  restoreTabs(valid, activeIndex);
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
      unsubscribe = () => {
        unsubDoc();
        unsubFile();
        unsubTabs();
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
