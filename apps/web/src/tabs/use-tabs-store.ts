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

export const restoreLive = (snapshot: TabSnapshot) => {
  const { doc, history, selection, pageId, camera, file } = snapshot;
  useDocumentStore.setState({ doc, history, selection, pageId, hoveredId: null });
  useFileStore.setState(file);
  useViewportStore.getState().setCamera(camera);
};

/** What a tab shows: its state, live for the active tab. */
export const tabState = (tab: Tab): TabSnapshot => tab.snapshot ?? captureLive();

/** File name of a project's design (one per project folder). */
export const PROJECT_DESIGN_FILE = "project.pego";

export const isProjectDesign = (bridgePath: string | null): boolean =>
  bridgePath !== null && /[\\/]project\.pego$/i.test(bridgePath);

/**
 * What a document is called in tabs and the header: a project's design shows the project
 * (its document name), other files their file name, new documents "Untitled".
 */
export const documentTitle = (
  doc: PegoDocument,
  file: Pick<TabFile, "fileName" | "bridgePath">,
): string => (isProjectDesign(file.bridgePath) ? doc.name : (file.fileName ?? "Untitled"));

export const tabTitle = (tab: Tab): string => {
  const state = tabState(tab);
  return documentTitle(state.doc, state.file);
};

export const tabIsDirty = (tab: Tab): boolean => {
  const state = tabState(tab);
  return isDirty(state.doc, state.file.savedDoc);
};

/** A run of the panel agent edits the live document: switching away mid-run is not allowed. */
export const blockedByRun = (): boolean => {
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
  restoreLive(target.snapshot);
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

/** The tab already showing the file at `bridgePath`, if any. */
export const findTabByPath = (bridgePath: string): Tab | undefined =>
  useTabsStore.getState().tabs.find((tab) => tabState(tab).file.bridgePath === bridgePath);

/** What to do when the shown document has unsaved changes and another one should replace it. */
export type UnsavedPolicy = "ask" | "refuse" | "discard";
export type OpenResult = "opened" | "busy" | "unsaved";

/**
 * Show `doc` as the workspace's document (there is one per workspace; screens are pages).
 * Unsaved changes of the current document are asked about ("ask", the user), refused
 * ("refuse", Claude Code: save first) or dropped ("discard"). `saved` marks `doc` as matching
 * its file.
 */
export const openTab = (
  doc: PegoDocument,
  file: Partial<Omit<TabFile, "savedDoc">>,
  options: { saved?: boolean; unsaved?: UnsavedPolicy } = {},
): OpenResult => {
  if (blockedByRun()) return "busy";
  const live = captureLive();
  if (isDirty(live.doc, live.file.savedDoc)) {
    const policy = options.unsaved ?? "ask";
    if (policy === "refuse") return "unsaved";
    if (
      policy === "ask" &&
      !window.confirm(
        `"${documentTitle(live.doc, live.file)}" has unsaved changes. Open the other document anyway?`,
      )
    ) {
      return "unsaved";
    }
  }
  const id = createId();
  useTabsStore.setState({ tabs: [{ id, snapshot: null }], activeId: id });
  loadIntoActive(doc, file, options.saved ?? true);
  return "opened";
};

/** Put a document into the live stores (the active tab), fitted to the view. */
export const loadIntoActive = (
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

/** A new empty document in place of the current one (asking about unsaved changes). */
export const newTab = (): OpenResult => openTab(createEmptyDocument(), {}, { saved: true });

/** Replace every tab (autosave restore). The first snapshot with `active` becomes the live tab. */
export const restoreTabs = (snapshots: TabSnapshot[], activeIndex: number): void => {
  if (snapshots.length === 0) return;
  const index = Math.min(Math.max(activeIndex, 0), snapshots.length - 1);
  const tabs = snapshots.map((snapshot, i) => ({
    id: createId(),
    snapshot: i === index ? null : snapshot,
  }));
  restoreLive(snapshots[index]!);
  useTabsStore.setState({ tabs, activeId: tabs[index]!.id });
};
