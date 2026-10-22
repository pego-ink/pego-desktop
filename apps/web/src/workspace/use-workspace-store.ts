import { create } from "zustand";
import type { PegoDocument } from "@pego/doc";
import type { ProjectInfo } from "@pego/agent";
import { createEmptyDocument } from "@/persistence/file-format";
import { getIsDirty, useFileStore } from "@/persistence/use-file-store";
import {
  blockedByRun,
  captureLive,
  loadIntoActive,
  restoreLive,
  runBeforeSwap,
  snapshotIsDirty,
  type DocumentSnapshot,
} from "./live-document";

/**
 * Workspaces: the scratch area (local files, the default document source) plus every open bridge
 * project, shown as tabs in the header while a bridge serves a design folder. Each workspace has
 * one document. Only one workspace is live (its document is in the editor stores, see
 * live-document.ts); the others keep a snapshot of that state.
 */

export const SCRATCH_ID = "scratch";

export type SavedWorkspace = DocumentSnapshot;

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

const restoreWorkspace = (saved: SavedWorkspace | null) => {
  if (saved) {
    restoreLive(saved);
    return;
  }
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
  // Pending autosave of the outgoing document is written before it leaves the stores.
  runBeforeSwap();
  const current = captureLive();
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

/** The workspace's document has unsaved changes. */
export const workspaceIsDirty = (workspace: Workspace): boolean =>
  workspace.saved ? snapshotIsDirty(workspace.saved) : getIsDirty();

/** Any open document has unsaved changes. */
export const anyWorkspaceDirty = (): boolean =>
  useWorkspaceStore.getState().workspaces.some(workspaceIsDirty);

/** The workspace whose document lives at `bridgePath` on disk, if one is open. */
export const findWorkspaceByPath = (bridgePath: string): Workspace | undefined =>
  useWorkspaceStore
    .getState()
    .workspaces.find((workspace) =>
      workspace.saved
        ? workspace.saved.file.bridgePath === bridgePath
        : useFileStore.getState().bridgePath === bridgePath,
    );

/**
 * A background autosave wrote `doc` after its workspace was switched away: mark that snapshot
 * saved (when it still holds exactly that document).
 */
export const markSavedInBackground = (doc: PegoDocument): void =>
  useWorkspaceStore.setState((state) => ({
    workspaces: state.workspaces.map((workspace) =>
      workspace.saved?.doc === doc
        ? {
            ...workspace,
            saved: { ...workspace.saved, file: { ...workspace.saved.file, savedDoc: doc } },
          }
        : workspace,
    ),
  }));

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
