import { starterDocument, type PegoDocument } from "@pego/doc";
import type { ProjectTarget } from "@pego/agent";
import { requestProject } from "@/agent/bridge-client";
import { parseDocumentFile } from "@/persistence/file-format";
import { visibleTarget, type DocumentTarget } from "./document-target";
import { PROJECT_DESIGN_FILE, snapshotOf, type DocumentSnapshot } from "./live-document";
import { useWorkspaceStore, type Workspace } from "./use-workspace-store";

/**
 * Where an MCP tool call that names a project edits: that project's tab, shown or in the
 * background. A project without a tab gets one in the background, loaded from its design file,
 * so an agent in a terminal can work on it while the editor shows something else; the tab's own
 * autosave writes the changes.
 */

const tabOf = (project: ProjectTarget): Workspace | undefined =>
  useWorkspaceStore
    .getState()
    .workspaces.find((workspace) => workspace.id === project.id || workspace.dir === project.dir);

/** Reads a design file's text; throws when it cannot be read. */
type DesignReader = (path: string) => Promise<string>;

/**
 * The project's design as a background snapshot. A new design starts only when the project has no
 * design file yet; a file that exists but cannot be read or parsed is an error, never an empty
 * design, because the tab's autosave would write that over the real file.
 */
export const loadProjectSnapshot = async (
  project: ProjectTarget,
  read: DesignReader,
): Promise<DocumentSnapshot> => {
  const file = { fileName: PROJECT_DESIGN_FILE, bridgePath: project.mainFile };
  if (!project.hasMainFile) {
    return snapshotOf(starterDocument(project.name, project.id), file, false);
  }
  const text = await read(project.mainFile);
  const parsed: PegoDocument = parseDocumentFile(text);
  // A project's design takes the project's id; adopting it is a change the next save writes.
  const doc = parsed.id === project.id ? parsed : { ...parsed, id: project.id };
  return snapshotOf(doc, file, doc === parsed);
};

const readDesign = async (path: string): Promise<string> => {
  try {
    const { text } = await requestProject("read", path);
    if (text === undefined) throw new Error("the bridge returned no content");
    return text;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Could not read ${path} (${reason}). The project was not opened, so its design is untouched; try again.`,
      { cause: error },
    );
  }
};

/** Loads in flight per project, so parallel calls open one tab. */
const loading = new Map<string, Promise<DocumentTarget>>();

/** The tab of `project` when it is the one shown: its live document, or an error. */
const liveTarget = (project: ProjectTarget): DocumentTarget => {
  const shown = visibleTarget();
  if (shown) return shown;
  throw new Error(`Project ${project.name} is open but its document is not available; try again.`);
};

const isLive = (tab: Workspace | undefined): boolean =>
  tab !== undefined && useWorkspaceStore.getState().liveId === tab.id;

const openInBackground = async (
  project: ProjectTarget,
  read: DesignReader,
): Promise<DocumentTarget> => {
  const snapshot = await loadProjectSnapshot(project, read);
  // The user may have opened or loaded the project while the file was being read: their tab wins,
  // the copy read from disk is stale.
  const existing = tabOf(project);
  if (isLive(existing)) return liveTarget(project);
  if (existing?.saved) return { workspaceId: existing.id, docId: existing.saved.doc.id };
  useWorkspaceStore.setState((state) => ({
    workspaces: existing
      ? state.workspaces.map((workspace) =>
          workspace.id === existing.id ? { ...workspace, saved: snapshot } : workspace,
        )
      : [
          ...state.workspaces,
          {
            id: project.id,
            kind: "project",
            name: project.name,
            dir: project.dir,
            saved: snapshot,
          },
        ],
  }));
  return { workspaceId: existing?.id ?? project.id, docId: snapshot.doc.id };
};

/**
 * The document an MCP call for `project` edits; its tab is opened in the background if needed.
 * Throws a message for the agent when the design cannot be loaded.
 */
export const projectTarget = async (
  project: ProjectTarget,
  read: DesignReader = readDesign,
): Promise<DocumentTarget> => {
  const tab = tabOf(project);
  if (isLive(tab)) return liveTarget(project);
  if (tab?.saved) return { workspaceId: tab.id, docId: tab.saved.doc.id };
  const pending = loading.get(project.id) ?? openInBackground(project, read);
  loading.set(project.id, pending);
  try {
    return await pending;
  } finally {
    loading.delete(project.id);
  }
};
