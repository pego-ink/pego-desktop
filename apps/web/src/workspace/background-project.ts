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

/** The project's design as a background snapshot (a new design when it has no file yet). */
export const loadProjectSnapshot = async (
  project: ProjectTarget,
  read: (path: string) => Promise<string | null>,
): Promise<DocumentSnapshot> => {
  const file = { fileName: PROJECT_DESIGN_FILE, bridgePath: project.mainFile };
  const text = await read(project.mainFile);
  if (text === null) return snapshotOf(starterDocument(project.name, project.id), file, false);
  const parsed: PegoDocument = parseDocumentFile(text);
  // A project's design takes the project's id; adopting it is a change the next save writes.
  const doc = parsed.id === project.id ? parsed : { ...parsed, id: project.id };
  return snapshotOf(doc, file, doc === parsed);
};

const readDesign = async (path: string): Promise<string | null> => {
  try {
    return (await requestProject("read", path)).text ?? null;
  } catch {
    return null;
  }
};

/** Loads in flight per project, so parallel calls open one tab. */
const loading = new Map<string, Promise<DocumentTarget>>();

const openInBackground = async (project: ProjectTarget): Promise<DocumentTarget> => {
  const snapshot = await loadProjectSnapshot(project, readDesign);
  const existing = tabOf(project);
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

/** The document an MCP call for `project` edits; its tab is opened in the background if needed. */
export const projectTarget = async (project: ProjectTarget): Promise<DocumentTarget> => {
  const tab = tabOf(project);
  if (tab && useWorkspaceStore.getState().liveId === tab.id) {
    const shown = visibleTarget();
    if (shown) return shown;
  }
  if (tab?.saved) return { workspaceId: tab.id, docId: tab.saved.doc.id };
  const pending = loading.get(project.id) ?? openInBackground(project);
  loading.set(project.id, pending);
  try {
    return await pending;
  } finally {
    loading.delete(project.id);
  }
};
