import { toast } from "sonner";
import {
  collectDocIds,
  commit as commitOps,
  createId,
  emptyHistory,
  extendLast as extendLastOps,
  starterDocument,
  type Op,
  type PegoDocument,
  type Transaction,
} from "@pego/doc";
import type { ToolTarget } from "@pego/agent";
import { getLayout } from "@/canvas/layout";
import { contentBounds, fitCamera } from "@/interaction/camera";
import { parseDocumentFile, serializeDocument } from "@/persistence/file-format";
import { useViewportStore } from "@/store/use-viewport-store";
import type { TabSnapshot } from "@/tabs/use-tabs-store";
import {
  addBackgroundWorkspace,
  backgroundSnapshot,
  liveWorkspace,
  updateBackgroundSnapshot,
  useWorkspaceStore,
} from "@/workspace/use-workspace-store";
import { requestProject, saveFileViaBridge } from "./bridge-client";
import { createToolHost, renderDocNodeImage, type AgentToolHost } from "./tool-host";

/**
 * Tools that name a project (MCP calls with `project`) edit that project even when the window
 * shows another one: its workspace is opened without being shown and its document is changed
 * there, with its own undo history, and saved to its project.pego shortly after each change.
 */

type TargetProject = ToolTarget["project"];

const SAVE_DELAY_MS = 800;
const PROJECT_FILE_NAME = "project.pego";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Where a project's design lives right now: the shown workspace, or one in the background. */
export type ProjectPlace = "live" | "background";

const placeOf = (id: string): ProjectPlace | null => {
  if (liveWorkspace().id === id) return "live";
  return backgroundSnapshot(id) ? "background" : null;
};

const snapshotFor = (doc: PegoDocument, mainFile: string, saved: boolean): TabSnapshot => {
  const { size, camera } = useViewportStore.getState();
  const bounds = contentBounds(doc, getLayout(doc));
  return {
    doc,
    history: emptyHistory(),
    selection: [],
    camera: bounds && size.width > 0 && size.height > 0 ? fitCamera(bounds, size) : camera,
    file: {
      fileName: PROJECT_FILE_NAME,
      handle: null,
      bridgePath: mainFile,
      savedDoc: saved ? doc : null,
    },
  };
};

const loading = new Map<string, Promise<ProjectPlace>>();

const loadProject = async (project: TargetProject): Promise<ProjectPlace> => {
  let doc: PegoDocument;
  let saved = true;
  try {
    const response = await requestProject("read", project.mainFile);
    doc = parseDocumentFile(response.text ?? "");
  } catch (error) {
    // A project without its design yet starts one; anything else (a broken file) is reported.
    if (!/not found/i.test(errorMessage(error))) throw error;
    doc = starterDocument(project.name);
    saved = false;
  }
  // The user may have opened it while the file was read.
  const now = placeOf(project.id);
  if (now) return now;
  addBackgroundWorkspace(project, snapshotFor(doc, project.mainFile, saved));
  if (!saved) scheduleSave(project.id);
  return "background";
};

/** Make sure the project's design is loaded (shown or in the background) and say where. */
export const ensureProjectLoaded = (project: TargetProject): Promise<ProjectPlace> => {
  const place = placeOf(project.id);
  if (place) return Promise.resolve(place);
  // An open workspace whose document is unknown cannot happen: live or saved, always one.
  const pending = loading.get(project.id);
  if (pending) return pending;
  const job = loadProject(project).finally(() => loading.delete(project.id));
  loading.set(project.id, job);
  return job;
};

// ---- saving ------------------------------------------------------------------------------------

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const writeBackground = async (id: string) => {
  const snapshot = backgroundSnapshot(id);
  // Shown in the window by now: the editor's own auto save writes it.
  if (!snapshot?.file.bridgePath) return;
  const { doc } = snapshot;
  if (doc === snapshot.file.savedDoc) return;
  const name = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)?.name ?? id;
  try {
    await saveFileViaBridge(snapshot.file.bridgePath, serializeDocument(doc));
    updateBackgroundSnapshot(id, (current) =>
      current.doc === doc ? { ...current, file: { ...current.file, savedDoc: doc } } : current,
    );
  } catch (error) {
    toast.error(`Could not save ${name}: ${errorMessage(error)}`);
  }
};

/** Drop pending background saves (tests). */
export const cancelBackgroundSaves = () => {
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
};

/** Save a background project's design shortly (edits in a burst share one write). */
export const scheduleSave = (id: string) => {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id);
      void writeBackground(id);
    }, SAVE_DELAY_MS),
  );
};

// ---- tool host --------------------------------------------------------------------------------

const missing = () =>
  new Error("The project is no longer open in the background (it was shown or closed); try again.");

/** A ToolHost over a background project's document. */
export const createBackgroundToolHost = (
  workspaceId: string,
  label: () => string,
): AgentToolHost => {
  // Plans, steps, decisions, icons and images work like for the shown document.
  const base = createToolHost({ label, countTransactions: false });
  let lastSeen: Transaction | null = null;

  const current = (): TabSnapshot => {
    const snapshot = backgroundSnapshot(workspaceId);
    if (!snapshot) throw missing();
    return snapshot;
  };

  const applyOps = (ops: Op[]) => {
    if (ops.length === 0) return;
    const snapshot = current();
    const extend = lastSeen !== null && snapshot.history.past.at(-1) === lastSeen;
    // Both throw OpError for an op that does not fit; the tools turn it into an error result.
    const next = extend
      ? extendLastOps(snapshot.doc, snapshot.history, ops)
      : commitOps(snapshot.doc, snapshot.history, ops, { source: "agent", label: label() });
    const ids = collectDocIds(next.doc);
    updateBackgroundSnapshot(workspaceId, (state) => ({
      ...state,
      doc: next.doc,
      history: next.history,
      selection: state.selection.filter((id) => ids.has(id)),
    }));
    lastSeen = next.history.past.at(-1) ?? null;
    scheduleSave(workspaceId);
  };

  const setSelection = (ids: string[]) => {
    const known = collectDocIds(current().doc);
    updateBackgroundSnapshot(workspaceId, (state) => ({
      ...state,
      selection: [...new Set(ids)].filter((id) => known.has(id)),
    }));
  };

  return {
    ...base,
    getDoc: () => current().doc,
    getLayout: () => getLayout(current().doc),
    getSelection: () => current().selection,
    setSelection,
    // Nothing to pan or highlight: the window shows another document.
    focusViewport: () => {},
    setFocus: () => {},
    renderImage: (nodeId, options) => renderDocNodeImage(current().doc, nodeId, options),
    applyOps,
    newGroup: () => {
      lastSeen = null;
    },
  };
};

// ---- save_document for a background project ---------------------------------------------------

let pendingSnapshot: { id: string; workspaceId: string; doc: PegoDocument } | null = null;

/** Editor side of save_document with `project`, for a project in the background. */
export const snapshotBackground = (workspaceId: string) => {
  const snapshot = backgroundSnapshot(workspaceId);
  if (!snapshot) return { content: missing().message, isError: true };
  pendingSnapshot = { id: createId(), workspaceId, doc: snapshot.doc };
  return {
    content: JSON.stringify({
      text: serializeDocument(snapshot.doc),
      path: snapshot.file.bridgePath,
      name: snapshot.file.fileName,
      snapshotId: pendingSnapshot.id,
    }),
    isError: false,
  };
};

export const markBackgroundSaved = (workspaceId: string, input: unknown) => {
  const snapshotId =
    typeof input === "object" && input !== null
      ? (input as { snapshotId?: unknown }).snapshotId
      : null;
  if (
    !pendingSnapshot ||
    pendingSnapshot.id !== snapshotId ||
    pendingSnapshot.workspaceId !== workspaceId
  ) {
    return { content: "No matching snapshot to mark as saved.", isError: true };
  }
  const { doc } = pendingSnapshot;
  pendingSnapshot = null;
  updateBackgroundSnapshot(workspaceId, (state) => ({
    ...state,
    file: { ...state.file, savedDoc: doc },
  }));
  return { content: "ok", isError: false };
};
