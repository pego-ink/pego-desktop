import { OpError, planRunUndo, type Op } from "@pego/doc";
import { sessionHome, setSessionHome, type SessionHome } from "@/agent/sessions/session-home";
import {
  checkRunUndo,
  commitCore,
  extendCore,
  useDocumentStore,
  type CommitMeta,
  type DocumentCore,
} from "@/store/use-document-store";
import { findWorkspace, updateBackground, useWorkspaceStore } from "./use-workspace-store";

/**
 * The document an agent run edits: a tab and the document it held when the run started. Whether
 * that tab is shown or in the background, reads and edits reach the right document: through the
 * document store while it is shown (so the canvas updates), else through the tab's snapshot. A tab
 * that was closed, or now holds another document, makes the target unreadable (null).
 */
export type DocumentTarget = SessionHome;

/** The document shown in the editor, or null when no tab is open. */
export const visibleTarget = (): DocumentTarget | null => {
  const { liveId } = useWorkspaceStore.getState();
  if (liveId === null) return null;
  return { workspaceId: liveId, docId: useDocumentStore.getState().doc.id };
};

export const isTargetVisible = (target: DocumentTarget): boolean =>
  useWorkspaceStore.getState().liveId === target.workspaceId &&
  useDocumentStore.getState().doc.id === target.docId;

/** The target's editable state, or null when its tab is gone or holds another document. */
export const readTarget = (target: DocumentTarget): DocumentCore | null => {
  if (isTargetVisible(target)) return useDocumentStore.getState();
  if (useWorkspaceStore.getState().liveId === target.workspaceId) return null;
  const saved = findWorkspace(target.workspaceId)?.saved;
  if (!saved || saved.doc.id !== target.docId) return null;
  return {
    doc: saved.doc,
    history: saved.history,
    selection: saved.selection,
    hoveredId: null,
    pageId: saved.pageId,
  };
};

/** Apply a transition to a background tab's snapshot. False when an op does not fit. */
const writeBackground = (
  target: DocumentTarget,
  apply: (core: DocumentCore) => Pick<DocumentCore, "doc" | "history" | "selection">,
): boolean => {
  const core = readTarget(target);
  if (!core) return false;
  try {
    const next = apply(core);
    return updateBackground(target.workspaceId, (snapshot) => ({
      ...snapshot,
      doc: next.doc,
      history: next.history,
      selection: next.selection,
    }));
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    console.warn(error);
    return false;
  }
};

/** `commit` on the target's document (see useDocumentStore.commit). */
export const commitToTarget = (target: DocumentTarget, ops: Op[], meta?: CommitMeta): boolean =>
  isTargetVisible(target)
    ? useDocumentStore.getState().commit(ops, meta)
    : writeBackground(target, (core) => commitCore(core, ops, meta));

/** `extendLast` on the target's document. */
export const extendTarget = (target: DocumentTarget, ops: Op[]): boolean =>
  isTargetVisible(target)
    ? useDocumentStore.getState().extendLast(ops)
    : writeBackground(target, (core) => extendCore(core, ops));

type RunUndoResult = { ok: boolean; message?: string };
const CLOSED: RunUndoResult = { ok: false, message: "The document of this run is not open" };

/** Can the run's changes be reverted in the target's document? */
export const canUndoRunIn = (target: DocumentTarget, runId: string): RunUndoResult => {
  const core = readTarget(target);
  return core ? checkRunUndo(core, runId) : CLOSED;
};

/** Revert only this run's changes in the target's document, as one new undo step. */
export const undoRunIn = (target: DocumentTarget, runId: string): RunUndoResult => {
  if (isTargetVisible(target)) return useDocumentStore.getState().undoRun(runId);
  const core = readTarget(target);
  if (!core) return CLOSED;
  const plan = planRunUndo(core.doc, core.history, runId);
  if (!plan.ok) return { ok: false, message: plan.message };
  const ok = writeBackground(target, (state) =>
    commitCore(state, plan.ops, { source: "user", label: plan.label }),
  );
  return ok ? { ok } : { ok, message: "Could not apply the undo" };
};

/**
 * The document a run in this chat session edits: the session's tab (recorded when it entered
 * memory), else the visible document, which then becomes its home. Undefined with no tab open
 * (the host then follows whatever the editor shows).
 */
export const runTargetFor = (sessionId: string): DocumentTarget | undefined => {
  const home = sessionHome(sessionId);
  if (home) return home;
  const visible = visibleTarget();
  if (!visible) return undefined;
  setSessionHome(sessionId, visible);
  return visible;
};
