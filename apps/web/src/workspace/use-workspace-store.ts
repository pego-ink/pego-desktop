import { create } from "zustand";
import { createId } from "@pego/doc";
import type { ProjectInfo } from "@pego/agent";
import { createEmptyDocument, isDirty } from "@/persistence/file-format";
import {
  blockedByRun,
  captureLive,
  loadIntoActive,
  restoreLive,
  tabIsDirty,
  useTabsStore,
  type Tab,
  type TabSnapshot,
} from "@/tabs/use-tabs-store";

/**
 * Workspaces: the scratch area plus every open project, shown as tabs in the header next to the
 * dashboard. Each keeps its own document tabs. Like document tabs, only one workspace is live
 * (its tabs are in the tabs store, its active document in the editor stores); the others keep
 * a saved copy of that state.
 */

export const SCRATCH_ID = "scratch";

export type SavedWorkspace = { tabs: Tab[]; activeId: string; live: TabSnapshot };

export type Workspace = {
  id: string;
  name: string;
  /** Project folder; null for the scratch workspace. */
  dir: string | null;
  kind: "scratch" | "project";
  /** Null while live. */
  saved: SavedWorkspace | null;
};

type WorkspaceState = {
  workspaces: Workspace[];
  liveId: string;
  view: "dashboard" | "editor";
};

const scratch = (): Workspace => ({
  id: SCRATCH_ID,
  name: "Scratch",
  dir: null,
  kind: "scratch",
  saved: null,
});

export const useWorkspaceStore = create<WorkspaceState>(() => ({
  workspaces: [scratch()],
  liveId: SCRATCH_ID,
  view: "editor",
}));

/** The workspace whose documents are in the editor. */
export const liveWorkspace = (): Workspace => {
  const { workspaces, liveId } = useWorkspaceStore.getState();
  return workspaces.find((workspace) => workspace.id === liveId) ?? workspaces[0]!;
};

/** The live workspace when it is a project (for the project panel and the MCP tools). */
export const liveProject = (): Workspace | null => {
  const workspace = liveWorkspace();
  return workspace.kind === "project" ? workspace : null;
};

const captureWorkspace = (): SavedWorkspace => {
  const { tabs, activeId } = useTabsStore.getState();
  return { tabs, activeId, live: captureLive() };
};

const restoreWorkspace = (saved: SavedWorkspace | null) => {
  if (saved) {
    useTabsStore.setState({ tabs: saved.tabs, activeId: saved.activeId });
    restoreLive(saved.live);
    return;
  }
  const id = createId();
  useTabsStore.setState({ tabs: [{ id, snapshot: null }], activeId: id });
  loadIntoActive(createEmptyDocument(), {}, true);
};

/** Make a workspace live and show the editor. False while a panel agent run blocks switching. */
export const activateWorkspace = (id: string): boolean => {
  const state = useWorkspaceStore.getState();
  const target = state.workspaces.find((workspace) => workspace.id === id);
  if (!target) return false;
  if (id === state.liveId) {
    useWorkspaceStore.setState({ view: "editor" });
    return true;
  }
  if (blockedByRun()) return false;
  const current = captureWorkspace();
  restoreWorkspace(target.saved);
  useWorkspaceStore.setState({
    liveId: id,
    view: "editor",
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === state.liveId
        ? { ...workspace, saved: current }
        : workspace.id === id
          ? { ...workspace, saved: null }
          : workspace,
    ),
  });
  return true;
};

/** Open (or show) a project's workspace. */
export const openProjectWorkspace = (
  project: Pick<ProjectInfo, "id" | "name" | "dir">,
): boolean => {
  const { workspaces } = useWorkspaceStore.getState();
  if (!workspaces.some((workspace) => workspace.id === project.id)) {
    useWorkspaceStore.setState({
      workspaces: [
        ...workspaces,
        { id: project.id, name: project.name, dir: project.dir, kind: "project", saved: null },
      ],
    });
  } else {
    // Keep name and folder current (renamed or moved on disk).
    useWorkspaceStore.setState({
      workspaces: workspaces.map((workspace) =>
        workspace.id === project.id
          ? { ...workspace, name: project.name, dir: project.dir }
          : workspace,
      ),
    });
  }
  return activateWorkspace(project.id);
};

export const showDashboard = (): void => useWorkspaceStore.setState({ view: "dashboard" });
export const showEditor = (): void => useWorkspaceStore.setState({ view: "editor" });

/** Tabs of a workspace with unsaved changes. */
export const workspaceIsDirty = (workspace: Workspace): boolean => {
  if (!workspace.saved) return useTabsStore.getState().tabs.some(tabIsDirty);
  const { tabs, live } = workspace.saved;
  return tabs.some((tab) =>
    tab.snapshot
      ? isDirty(tab.snapshot.doc, tab.snapshot.file.savedDoc)
      : isDirty(live.doc, live.file.savedDoc),
  );
};

/** Close a project workspace (asking when it has unsaved documents). Scratch stays. */
export const closeWorkspace = (id: string): void => {
  const state = useWorkspaceStore.getState();
  const workspace = state.workspaces.find((candidate) => candidate.id === id);
  if (!workspace || workspace.kind === "scratch") return;
  if (
    workspaceIsDirty(workspace) &&
    !window.confirm(`"${workspace.name}" has unsaved documents. Close the project anyway?`)
  ) {
    return;
  }
  if (id === state.liveId && !activateWorkspace(SCRATCH_ID)) return;
  useWorkspaceStore.setState((current) => ({
    workspaces: current.workspaces.filter((candidate) => candidate.id !== id),
    view: id === state.liveId ? "dashboard" : current.view,
  }));
};

/** Replace all workspaces (autosave restore). `liveIndex` points at the one to make live. */
export const restoreWorkspaces = (
  workspaces: Omit<Workspace, "saved">[],
  saved: (SavedWorkspace | null)[],
  liveIndex: number,
  view: WorkspaceState["view"],
): void => {
  if (workspaces.length === 0) return;
  const index = Math.min(Math.max(liveIndex, 0), workspaces.length - 1);
  const withScratch = workspaces.some((workspace) => workspace.kind === "scratch");
  const list: Workspace[] = workspaces.map((workspace, i) => ({
    ...workspace,
    saved: i === index ? null : (saved[i] ?? null),
  }));
  restoreWorkspace(saved[index] ?? null);
  useWorkspaceStore.setState({
    workspaces: withScratch ? list : [scratch(), ...list],
    liveId: list[index]!.id,
    view,
  });
};
