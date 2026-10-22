import { toast } from "sonner";
import { create } from "zustand";
import { createId, type History, type PegoDocument } from "@pego/doc";
import { useAgentStore } from "@/agent/use-agent-store";
import { getLayout } from "@/canvas/layout";
import type { Camera } from "@/canvas/types";
import { contentBounds } from "@/interaction/camera";
import { isRunActive } from "@/panels/agent/agent-format";
import { createEmptyDocument, isDirty } from "@/persistence/file-format";
import type { PegoFileHandle } from "@/persistence/fs-access";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/**
 * Open documents as tabs. The active tab lives in the regular stores (document, file, viewport),
 * so the rest of the editor is unaware of tabs; inactive tabs keep a snapshot of that state.
 */

export type TabFile = {
  fileName: string | null;
  handle: PegoFileHandle | null;
  bridgePath: string | null;
  savedDoc: PegoDocument | null;
};

export type TabSnapshot = {
  doc: PegoDocument;
  history: History;
  selection: string[];
  pageId: string | null;
  camera: Camera;
  file: TabFile;
};

export type Tab = {
  id: string;
  /** Null while the tab is active (its state is in the live stores). */
  snapshot: TabSnapshot | null;
};

type TabsState = { tabs: Tab[]; activeId: string };

const firstTab = createId();
export const useTabsStore = create<TabsState>(() => ({
  tabs: [{ id: firstTab, snapshot: null }],
  activeId: firstTab,
}));

/** The live state of the active tab. */
export const captureLive = (): TabSnapshot => {
  const { doc, history, selection, pageId } = useDocumentStore.getState();
  const { fileName, handle, bridgePath, savedDoc } = useFileStore.getState();
  return {
    doc,
    history,
    selection,
    pageId,
    camera: useViewportStore.getState().camera,
    file: { fileName, handle, bridgePath, savedDoc },
  };
};

const restore = (snapshot: TabSnapshot) => {
  const { doc, history, selection, pageId, camera, file } = snapshot;
  useDocumentStore.setState({ doc, history, selection, pageId, hoveredId: null });
  useFileStore.setState(file);
  useViewportStore.getState().setCamera(camera);
};

/** What a tab shows: its state, live for the active tab. */
export const tabState = (tab: Tab): TabSnapshot => tab.snapshot ?? captureLive();

export const tabTitle = (tab: Tab): string => tabState(tab).file.fileName ?? "Untitled";

export const tabIsDirty = (tab: Tab): boolean => {
  const state = tabState(tab);
  return isDirty(state.doc, state.file.savedDoc);
};

/** A run of the panel agent edits the live document: switching away mid-run is not allowed. */
const blockedByRun = (): boolean => {
  if (!isRunActive(useAgentStore.getState().status)) return false;
  toast.info("Wait for the agent run to finish (or stop it) before switching tabs.");
  return true;
};

export const switchTab = (id: string): boolean => {
  const { tabs, activeId } = useTabsStore.getState();
  if (id === activeId) return true;
  const target = tabs.find((tab) => tab.id === id);
  if (!target?.snapshot || blockedByRun()) return false;
  const live = captureLive();
  restore(target.snapshot);
  useTabsStore.setState({
    activeId: id,
    tabs: tabs.map((tab) =>
      tab.id === activeId
        ? { ...tab, snapshot: live }
        : tab.id === id
          ? { ...tab, snapshot: null }
          : tab,
    ),
  });
  return true;
};

/** An untitled, unsaved tab nobody has edited: opening a file reuses it instead of adding one. */
const isPristine = (tab: Tab): boolean => {
  const state = tabState(tab);
  return state.file.fileName === null && state.history.past.length === 0 && !state.file.bridgePath;
};

/** The tab already showing the file at `bridgePath`, if any. */
export const findTabByPath = (bridgePath: string): Tab | undefined =>
  useTabsStore.getState().tabs.find((tab) => tabState(tab).file.bridgePath === bridgePath);

/**
 * Show `doc` in a tab: a new one, or the active tab when it is an untouched untitled document.
 * `file` describes where it came from; `saved` marks it as matching that file.
 */
export const openTab = (
  doc: PegoDocument,
  file: Partial<Omit<TabFile, "savedDoc">>,
  options: { saved: boolean } = { saved: true },
): boolean => {
  if (blockedByRun()) return false;
  const { tabs, activeId } = useTabsStore.getState();
  const active = tabs.find((tab) => tab.id === activeId);
  if (active && !isPristine(active)) {
    const live = captureLive();
    const id = createId();
    useTabsStore.setState({
      activeId: id,
      tabs: [
        ...tabs.map((tab) => (tab.id === activeId ? { ...tab, snapshot: live } : tab)),
        { id, snapshot: null },
      ],
    });
  }
  loadIntoActive(doc, file, options.saved);
  return true;
};

/** Put a document into the live stores (the active tab), fitted to the view. */
const loadIntoActive = (
  doc: PegoDocument,
  file: Partial<Omit<TabFile, "savedDoc">>,
  saved: boolean,
) => {
  useDocumentStore.getState().load(doc);
  const loaded = useDocumentStore.getState().doc;
  useFileStore.setState({
    fileName: file.fileName ?? null,
    handle: file.handle ?? null,
    bridgePath: file.bridgePath ?? null,
    savedDoc: saved ? loaded : null,
  });
  useViewportStore.getState().zoomToFit(contentBounds(loaded, getLayout(loaded)));
};

export const newTab = (): boolean => openTab(createEmptyDocument(), {}, { saved: true });

/** Close a tab (asking first when it has unsaved changes). The last tab becomes a new document. */
export const closeTab = (id: string): void => {
  const { tabs, activeId } = useTabsStore.getState();
  const index = tabs.findIndex((tab) => tab.id === id);
  const tab = tabs[index];
  if (!tab) return;
  if (
    tabIsDirty(tab) &&
    !window.confirm(`"${tabTitle(tab)}" has unsaved changes. Close it anyway?`)
  ) {
    return;
  }
  if (id === activeId) {
    const neighbor = tabs[index + 1] ?? tabs[index - 1];
    if (neighbor) {
      if (!switchTab(neighbor.id)) return;
    } else {
      if (blockedByRun()) return;
      const replacement = createId();
      useTabsStore.setState({ tabs: [{ id: replacement, snapshot: null }], activeId: replacement });
      loadIntoActive(createEmptyDocument(), {}, true);
      return;
    }
  }
  useTabsStore.setState((state) => ({
    tabs: state.tabs.filter((candidate) => candidate.id !== id),
  }));
};

/** Replace every tab (autosave restore). The first snapshot with `active` becomes the live tab. */
export const restoreTabs = (snapshots: TabSnapshot[], activeIndex: number): void => {
  if (snapshots.length === 0) return;
  const index = Math.min(Math.max(activeIndex, 0), snapshots.length - 1);
  const tabs = snapshots.map((snapshot, i) => ({
    id: createId(),
    snapshot: i === index ? null : snapshot,
  }));
  restore(snapshots[index]!);
  useTabsStore.setState({ tabs, activeId: tabs[index]!.id });
};
