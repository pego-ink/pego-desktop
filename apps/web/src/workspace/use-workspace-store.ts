import { create } from "zustand";
import type { PegoDocument } from "@pego/doc";
import type { ProjectInfo } from "@pego/agent";
import { sessionHome } from "@/agent/sessions/session-home";
import { useAgentStore, type SessionLive } from "@/agent/use-agent-store";
import { isRunActive } from "@/panels/agent/agent-format";
import { createEmptyDocument } from "@/persistence/file-format";
import { getIsDirty, useFileStore, useIsDirty } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import {
  captureLive,
  documentTitle,
  fitLive,
  isProjectDesign,
  isSwapping,
  loadIntoActive,
  restoreLive,
  snapshotIsDirty,
  snapshotOf,
  swap,
  type DocumentFile,
  type DocumentSnapshot,
  type OpenResult,
  type UnsavedPolicy,
} from "./live-document";

/**
 * Workspaces are the editor's document tabs: one per open document, either a local document
 * (a .pego file, an untitled one, or a file the bridge opened) or a bridge project (its
 * project.pego). Exactly one is live: its document is in the editor stores (live-document.ts) and
 * the rest of the editor never deals with tabs. Every other tab keeps a snapshot of the same state
 * (`saved`): document, undo history, selection, page, camera and file. Agent runs keep editing a
 * background tab's snapshot (document-target.ts), so switching tabs never stops a run.
 *
 * The order of `workspaces` is the tab order; it, the live tab and the view are persisted with the
 * documents by the browser autosave (persistence/use-persistence.ts).
 */

export type WorkspaceKind = "local" | "project";

export type SavedWorkspace = DocumentSnapshot;

export type Workspace = {
  id: string;
  kind: WorkspaceKind;
  /** Tab label: the project's name, or the local document's title (kept in sync while live). */
  name: string;
  /** Project folder; null for local documents. */
  dir: string | null;
  /** The document state while in the background; null while live (and before first shown). */
  saved: SavedWorkspace | null;
};

type WorkspaceState = {
  workspaces: Workspace[];
  /** The tab whose document is in the editor; null when every tab was closed. */
  liveId: string | null;
  /** "dashboard" = the Home tab is shown (the live document stays loaded behind it). */
  view: "dashboard" | "editor";
};

const UNTITLED = "Untitled";

export const newWorkspaceId = (): string => `doc-${crypto.randomUUID()}`;

const localWorkspace = (id: string = newWorkspaceId(), name = UNTITLED): Workspace => ({
  id,
  kind: "local",
  name,
  dir: null,
  saved: null,
});

/** The app opens on Home with no tab; documents open from there (or from the restored tabs). */
const createWorkspaceStore = () =>
  create<WorkspaceState>(() => ({
    workspaces: [],
    liveId: null,
    view: "dashboard",
  }));

/**
 * Dev hot reload re-runs this module; keep the same store so open tabs (and the background
 * documents in their snapshots) survive an edit.
 */
export const useWorkspaceStore: ReturnType<typeof createWorkspaceStore> =
  (import.meta.hot?.data.workspaceStore as ReturnType<typeof createWorkspaceStore> | undefined) ??
  createWorkspaceStore();

if (import.meta.hot) {
  import.meta.hot.data.workspaceStore = useWorkspaceStore;
}

const current = () => useWorkspaceStore.getState();

export const findWorkspace = (id: string): Workspace | undefined =>
  current().workspaces.find((workspace) => workspace.id === id);

/** The tab whose document is in the editor, or null when none is open. */
export const liveWorkspace = (): Workspace | null => {
  const { liveId } = current();
  return liveId === null ? null : (findWorkspace(liveId) ?? null);
};

/** The live tab when it is a project (for the project panel and the MCP tools). */
export const liveProject = (): Workspace | null => {
  const workspace = liveWorkspace();
  return workspace?.kind === "project" ? workspace : null;
};

/**
 * A tab's document state: the editor stores while it is live, else its snapshot. Null for an
 * unknown tab or one that was never shown (it loads an empty document when activated).
 */
export const workspaceDocument = (id: string): DocumentSnapshot | null => {
  if (current().liveId === id) return captureLive();
  return findWorkspace(id)?.saved ?? null;
};

const patchWorkspace = (id: string, update: (workspace: Workspace) => Workspace) =>
  useWorkspaceStore.setState((state) => ({
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === id ? update(workspace) : workspace,
    ),
  }));

/** Change a background tab's snapshot (no-op while the tab is live or has none). */
export const updateBackground = (
  id: string,
  update: (snapshot: DocumentSnapshot) => DocumentSnapshot,
): boolean => {
  const workspace = findWorkspace(id);
  if (!workspace?.saved || current().liveId === id) return false;
  const saved = workspace.saved;
  patchWorkspace(id, (entry) => ({ ...entry, saved: update(saved) }));
  return true;
};

/** A write of `doc` to `file` landed: mark that tab saved, live or in the background. */
export const markWorkspaceSaved = (
  id: string,
  doc: PegoDocument,
  file: Omit<DocumentFile, "savedDoc">,
): void => {
  if (current().liveId === id) {
    useFileStore.getState().markSaved(doc, file.fileName, file.handle, file.bridgePath);
    return;
  }
  updateBackground(id, (snapshot) => ({ ...snapshot, file: { ...file, savedDoc: doc } }));
};

/** Local tabs are labelled with their document's title; follow renames and saves while live. */
const syncLiveName = () => {
  if (isSwapping()) return;
  const live = liveWorkspace();
  if (!live || live.kind !== "local") return;
  const name = documentTitle(useDocumentStore.getState().doc, useFileStore.getState());
  if (name !== live.name) patchWorkspace(live.id, (workspace) => ({ ...workspace, name }));
};

useFileStore.subscribe((state, prev) => {
  if (state.fileName !== prev.fileName || state.bridgePath !== prev.bridgePath) syncLiveName();
});

const restoreWorkspace = (saved: SavedWorkspace | null) => {
  if (saved) {
    restoreLive(saved);
    return;
  }
  loadIntoActive(createEmptyDocument(), {}, true);
};

/**
 * Show a tab: the live document goes into its tab's snapshot and the tab's snapshot into the
 * stores (undo history, selection, page and camera included). Runs keep going in both. False for
 * an unknown id.
 */
export const activateWorkspace = (id: string): boolean => {
  const state = current();
  const target = state.workspaces.find((workspace) => workspace.id === id);
  if (!target) return false;
  if (id === state.liveId) {
    useWorkspaceStore.setState({ view: "editor" });
    return true;
  }
  const outgoingId = state.liveId;
  const outgoing = outgoingId !== null && findWorkspace(outgoingId) ? captureLive() : null;
  // Store subscribers see a swap (isSwapping) and wait for the tab change below.
  swap(() => restoreWorkspace(target.saved));
  useWorkspaceStore.setState((latest) => ({
    liveId: id,
    view: "editor",
    workspaces: latest.workspaces.map((workspace) =>
      workspace.id === outgoingId
        ? { ...workspace, saved: outgoing }
        : workspace.id === id
          ? { ...workspace, saved: null }
          : workspace,
    ),
  }));
  syncLiveName();
  return true;
};

/** Open (or show) a project's tab. */
export const openProjectWorkspace = (
  project: Pick<ProjectInfo, "id" | "name" | "dir">,
): boolean => {
  if (!findWorkspace(project.id)) {
    useWorkspaceStore.setState((state) => ({
      workspaces: [
        ...state.workspaces,
        { id: project.id, name: project.name, dir: project.dir, kind: "project", saved: null },
      ],
    }));
  } else {
    // Keep name and folder current (renamed or moved on disk).
    patchWorkspace(project.id, (workspace) => ({
      ...workspace,
      name: project.name,
      dir: project.dir,
    }));
  }
  return activateWorkspace(project.id);
};

/** A new tab with an empty, untitled document, shown now. Returns its id. */
export const newDocumentTab = (): string => {
  const workspace = localWorkspace();
  useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, workspace] }));
  activateWorkspace(workspace.id);
  return workspace.id;
};

/** Show the Home tab (the live document stays loaded behind it). */
export const showDashboard = (): void => useWorkspaceStore.setState({ view: "dashboard" });

/** Show the editor; with no tab open, a new untitled one is created. */
export const showEditor = (): void => {
  if (current().liveId === null) {
    newDocumentTab();
    return;
  }
  useWorkspaceStore.setState({ view: "editor" });
};

/** Reorder the tabs (drag). Unknown ids are ignored; tabs left out keep their order at the end. */
export const reorderWorkspaces = (ids: string[]): void =>
  useWorkspaceStore.setState((state) => {
    const byId = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
    const ordered: Workspace[] = [];
    for (const id of ids) {
      const workspace = byId.get(id);
      if (!workspace) continue;
      ordered.push(workspace);
      byId.delete(id);
    }
    const rest = state.workspaces.filter((workspace) => byId.has(workspace.id));
    return { workspaces: [...ordered, ...rest] };
  });

/** The tab's document has unsaved changes. */
export const workspaceIsDirty = (workspace: Workspace): boolean => {
  if (workspace.id === current().liveId) return getIsDirty();
  return workspace.saved ? snapshotIsDirty(workspace.saved) : false;
};

/** Any open document has unsaved changes. */
export const anyWorkspaceDirty = (): boolean => current().workspaces.some(workspaceIsDirty);

/** The tab a chat session belongs to (sessions without a recorded home belong to the live tab). */
export const sessionWorkspaceId = (sessionId: string): string | null =>
  sessionHome(sessionId)?.workspaceId ?? current().liveId;

/** The session belongs to the document shown in the editor (its canvas cursor and focus show). */
export const sessionShownInEditor = (sessionId: string): boolean => {
  const home = sessionHome(sessionId);
  if (!home) return true;
  return home.workspaceId === current().liveId && home.docId === useDocumentStore.getState().doc.id;
};

const runningIn = (
  liveSessions: Readonly<Record<string, SessionLive>>,
  workspaceId: string,
): boolean =>
  Object.values(liveSessions).some(
    (live) => isRunActive(live.status) && sessionWorkspaceId(live.id) === workspaceId,
  );

/** Any agent run is working in this tab's document (its chat sessions). */
export const workspaceRunning = (id: string): boolean =>
  runningIn(useAgentStore.getState().liveSessions, id);

/** Reactive unsaved/running state of one tab (tab markers, close confirmation). */
export const useWorkspaceStatus = (id: string): { dirty: boolean; running: boolean } => {
  const live = useWorkspaceStore((state) => state.liveId === id);
  const backgroundDirty = useWorkspaceStore((state) => {
    const saved = state.workspaces.find((workspace) => workspace.id === id)?.saved;
    return saved ? snapshotIsDirty(saved) : false;
  });
  const liveDirty = useIsDirty();
  // Re-evaluated when the live tab changes too (sessions without a home follow it).
  useWorkspaceStore((state) => state.liveId);
  const running = useAgentStore((state) => runningIn(state.liveSessions, id));
  return { dirty: live ? liveDirty : backgroundDirty, running };
};

/** The tab's title as `documentTitle` gives it (reactive; a project's tab shows the project). */
export const useWorkspaceTitle = (id: string): string => {
  const live = useWorkspaceStore((state) => state.liveId === id);
  const background = useWorkspaceStore((state) => {
    const workspace = state.workspaces.find((entry) => entry.id === id);
    if (!workspace) return "";
    if (workspace.kind === "project" || !workspace.saved) return workspace.name;
    return documentTitle(workspace.saved.doc, workspace.saved.file);
  });
  const docName = useDocumentStore((state) => state.doc.name);
  const fileName = useFileStore((state) => state.fileName);
  const bridgePath = useFileStore((state) => state.bridgePath);
  if (!live) return background;
  return isProjectDesign(bridgePath) ? docName : (fileName ?? UNTITLED);
};

/** The tab that holds the file at `bridgePath`, if one is open. */
export const findWorkspaceByPath = (bridgePath: string): Workspace | undefined => {
  const { workspaces, liveId } = current();
  return workspaces.find((workspace) =>
    workspace.id === liveId
      ? useFileStore.getState().bridgePath === bridgePath
      : workspace.saved?.file.bridgePath === bridgePath,
  );
};

let cancelRunsIn: (workspaceId: string) => void = () => {};

/**
 * The agent layer (agent/run.ts) registers how to stop the runs of a tab being closed, and to
 * drop its chat sessions' queued messages (this store cannot import the run machinery).
 */
export const setWorkspaceRunCanceller = (cancel: (workspaceId: string) => void): void => {
  cancelRunsIn = cancel;
};

/**
 * Close a tab unless that loses something: "needs-confirm" when its document has unsaved changes
 * or an agent run works in it (ask, then `forceCloseWorkspace`), else it closes ("closed").
 */
export const closeWorkspace = (id: string): "closed" | "needs-confirm" => {
  const workspace = findWorkspace(id);
  if (!workspace) return "closed";
  if (workspaceIsDirty(workspace) || workspaceRunning(id)) return "needs-confirm";
  forceCloseWorkspace(id);
  return "closed";
};

/**
 * Close a tab whatever it holds: its runs are cancelled first and unsaved changes are dropped.
 * Closing the live tab shows its right neighbour (else the left one); closing the last tab leaves
 * no tab open (`liveId` null, the Home view).
 */
export const forceCloseWorkspace = (id: string): void => {
  const state = current();
  const index = state.workspaces.findIndex((workspace) => workspace.id === id);
  if (index < 0) return;
  cancelRunsIn(id);
  if (id === state.liveId) {
    const neighbour = state.workspaces[index + 1] ?? state.workspaces[index - 1];
    if (neighbour) {
      activateWorkspace(neighbour.id);
    } else {
      swap(() => loadIntoActive(createEmptyDocument(), {}, true));
      useWorkspaceStore.setState({ workspaces: [], liveId: null, view: "dashboard" });
      return;
    }
  }
  useWorkspaceStore.setState((latest) => ({
    workspaces: latest.workspaces.filter((workspace) => workspace.id !== id),
  }));
};

/**
 * Put a document in a tab and show it. "tab" (default): a new tab, or the live one when that is
 * an untouched untitled document. "replace": in place of the live tab's document (a project tab
 * loading its design; a reload), asking about its unsaved changes ("ask", the user), refusing
 * them ("refuse", Claude Code: save first) or dropping them ("discard"); "busy" while a run
 * works in it. `saved` marks `doc` as matching its file.
 */
export const openDocument = (
  doc: PegoDocument,
  file: Partial<Omit<DocumentFile, "savedDoc">>,
  options: { saved?: boolean; unsaved?: UnsavedPolicy; place?: "tab" | "replace" } = {},
): OpenResult => {
  const saved = options.saved ?? true;
  const live = liveWorkspace();
  if (options.place === "replace" && live) {
    if (workspaceRunning(live.id)) return "busy";
    const state = captureLive();
    if (snapshotIsDirty(state)) {
      const policy = options.unsaved ?? "ask";
      if (policy === "refuse") return "unsaved";
      if (
        policy === "ask" &&
        !window.confirm(
          `"${documentTitle(state.doc, state.file)}" has unsaved changes. Open the other document anyway?`,
        )
      ) {
        return "unsaved";
      }
    }
    loadIntoActive(doc, file, saved);
    useWorkspaceStore.setState({ view: "editor" });
    syncLiveName();
    return "opened";
  }
  if (live && isPristine(live)) {
    loadIntoActive(doc, file, saved);
    useWorkspaceStore.setState({ view: "editor" });
    syncLiveName();
    return "opened";
  }
  const workspace: Workspace = { ...localWorkspace(), saved: snapshotOf(doc, file, saved) };
  useWorkspaceStore.setState((state) => ({ workspaces: [...state.workspaces, workspace] }));
  activateWorkspace(workspace.id);
  fitLive();
  return "opened";
};

/** An untitled local tab nobody touched yet: opening a file reuses it instead of adding a tab. */
const isPristine = (workspace: Workspace): boolean => {
  if (workspace.kind !== "local" || workspaceRunning(workspace.id)) return false;
  const state = captureLive();
  return (
    !state.file.fileName &&
    !state.file.handle &&
    !state.file.bridgePath &&
    !snapshotIsDirty(state) &&
    state.history.past.length === 0
  );
};

/** A new empty document in a new tab. */
export const openNewDocument = (): OpenResult => {
  newDocumentTab();
  return "opened";
};

/**
 * Replace all tabs (autosave restore). `liveIndex` points at the one to show (-1: none, the Home
 * view). Autosaves of older Pego versions name local tabs "scratch".
 */
export const restoreWorkspaces = (
  workspaces: (Omit<Workspace, "saved" | "kind"> & { kind: WorkspaceKind | "scratch" })[],
  saved: (SavedWorkspace | null)[],
  liveIndex: number,
  view: WorkspaceState["view"],
): void => {
  if (workspaces.length === 0) return;
  const index = liveIndex < 0 ? -1 : Math.min(liveIndex, workspaces.length - 1);
  const list: Workspace[] = workspaces.map((workspace, i) => ({
    ...workspace,
    kind: workspace.kind === "project" ? "project" : "local",
    saved: i === index ? null : (saved[i] ?? null),
  }));
  if (index >= 0) swap(() => restoreWorkspace(saved[index] ?? null));
  useWorkspaceStore.setState({
    workspaces: list,
    liveId: index >= 0 ? list[index]!.id : null,
    view: index >= 0 ? view : "dashboard",
  });
  syncLiveName();
};
