import { useDocumentStore } from "@/store/use-document-store";
import { isRunActive, isRunFinished } from "@/panels/agent/agent-format";
import { cancelRun } from "@/agent/run";
import { sessionOf, useAgentStore } from "@/agent/use-agent-store";
import { deleteSession, getSession, listSessions, saveSession } from "./session-db";
import {
  emptySession,
  fromStoredSession,
  metaOf,
  sortMetas,
  toStoredSession,
  type SessionMeta,
} from "./session-model";
import { useSessionsStore } from "./use-sessions-store";

/**
 * Keeps the live agent session and IndexedDB in step. Writes happen when a run starts (its
 * prompt is stored, as cancelled until it ends), when it ends, and on rename; never per token.
 * Opening or creating a design file shows that file's newest session.
 */

const agent = () => useAgentStore.getState();
const sessions = () => useSessionsStore.getState();

/** Writes run one after another so an older snapshot never lands after a newer one. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

/** Bumped on every file change so a slow read for the previous file is dropped. */
let loadToken = 0;

const liveIsEmpty = () => {
  const s = agent();
  return s.turns.length === 0 && s.log.length === 0 && s.status === "idle";
};

const upsertMeta = (meta: SessionMeta, removed: readonly string[]) =>
  useSessionsStore.setState((state) => ({
    items: sortMetas([...state.items.filter((m) => m.id !== meta.id), meta]).filter(
      (m) => !removed.includes(m.id),
    ),
  }));

/** What was last written, to skip writes when nothing changed (switching must not reorder). */
let saved: { turns: unknown; log: unknown; status: unknown; title: unknown } | null = null;
const fingerprint = () => {
  const s = agent();
  return { turns: s.turns, log: s.log, status: s.status, title: s.sessionTitle };
};
const isDirty = () => {
  const now = fingerprint();
  return (
    !saved ||
    saved.turns !== now.turns ||
    saved.log !== now.log ||
    saved.status !== now.status ||
    saved.title !== now.title
  );
};

/** Store the live session under `docId` (no-op while it has no turn). Snapshot is taken now. */
const saveLive = (docId: string): Promise<void> => {
  const session = sessionOf(agent());
  if (session.turns.length === 0) return Promise.resolve();
  saved = fingerprint();
  const stored = toStoredSession(session, docId, Date.now());
  if (useSessionsStore.getState().docId === docId) upsertMeta(metaOf(stored), []);
  return enqueue(async () => {
    const removed = await saveSession(stored);
    if (removed.length > 0 && sessions().docId === docId) upsertMeta(metaOf(stored), removed);
  });
};

const showFresh = () => {
  agent().loadSession(emptySession());
  saved = fingerprint();
};

/** Resolves once no run is active (a cancelled API run ends asynchronously). */
const untilIdle = (timeoutMs = 3000): Promise<void> =>
  new Promise((resolve) => {
    if (!isRunActive(agent().status)) return resolve();
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsubscribe = useAgentStore.subscribe((state) => {
      if (!isRunActive(state.status)) done();
    });
  });

/** Open the design file `docId`: newest stored session, or an empty one. */
const openDoc = async (docId: string) => {
  const token = ++loadToken;
  useSessionsStore.setState({ docId, items: [] });
  showFresh();
  const stored = await enqueue(() => listSessions(docId));
  if (token !== loadToken) return;
  useSessionsStore.setState({ items: sortMetas(stored.map(metaOf)) });
  const newest = stored[0];
  // A run started while the list was loading keeps the panel.
  if (!newest || !liveIsEmpty()) return;
  agent().loadSession(fromStoredSession(newest));
  saved = fingerprint();
};

const currentDocId = () => sessions().docId;

export const isSessionBusy = () => isRunActive(agent().status);

/** Start an empty session. The old one is already stored; no-op mid-run or when already empty. */
export const startNewSession = async (): Promise<void> => {
  const docId = currentDocId();
  if (isSessionBusy() || !docId || liveIsEmpty()) return;
  if (isDirty()) await saveLive(docId);
  showFresh();
};

/** Read a stored session of the open file into the panel. */
const loadStored = async (id: string, docId: string): Promise<void> => {
  const stored = await enqueue(() => getSession(id));
  if (!stored || stored.docId !== docId) {
    useSessionsStore.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }));
    return;
  }
  if (isSessionBusy() || docId !== currentDocId()) return;
  agent().loadSession(fromStoredSession(stored));
  saved = fingerprint();
};

export const switchSession = async (id: string): Promise<void> => {
  const docId = currentDocId();
  if (isSessionBusy() || !docId || id === agent().sessionId) return;
  if (isDirty()) await saveLive(docId);
  await loadStored(id, docId);
};

export const removeSession = async (id: string): Promise<void> => {
  const active = id === agent().sessionId;
  if (active && isSessionBusy()) return;
  useSessionsStore.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }));
  await enqueue(() => deleteSession(id));
  if (!active) return;
  const next = sessions().items[0];
  const docId = currentDocId();
  // Not switchSession: that would first write the live session back, undoing the delete.
  if (next && docId) await loadStored(next.id, docId);
  else showFresh();
};

/** Rename a session; an empty title goes back to the one derived from the first prompt. */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const docId = currentDocId();
  if (!docId) return;
  const custom = title.trim() || null;
  if (id === agent().sessionId) {
    agent().setSessionTitle(custom);
    await saveLive(docId);
    return;
  }
  const stored = await enqueue(() => getSession(id));
  if (!stored) return;
  const session = fromStoredSession(stored);
  const next = toStoredSession({ ...session, customTitle: custom }, docId, stored.updatedAt);
  upsertMeta(metaOf(next), []);
  await enqueue(() => saveSession(next));
};

/**
 * Wire the live stores to the session database. Call once at app start; returns the cleanup.
 */
export const startSessionSync = (): (() => void) => {
  const unsubscribeAgent = useAgentStore.subscribe((state, prev) => {
    const docId = currentDocId();
    if (!docId) return;
    const started = state.log.length > 0 && prev.log.length === 0 && isRunActive(state.status);
    const ended = isRunFinished(state.status) && !isRunFinished(prev.status);
    if (started || ended) void saveLive(docId);
  });

  let lastDocId: string | null = null;
  const followDoc = async () => {
    const docId = useDocumentStore.getState().doc.id;
    if (docId === lastDocId) return;
    const previous = lastDocId;
    lastDocId = docId;
    if (previous) {
      // The agent works on the open file; a run must not carry over to the next one. The run's
      // end is stored under the old file (the sessions store still points at it) before we move.
      cancelRun();
      await untilIdle();
      if (lastDocId !== docId) return;
      if (isDirty()) await saveLive(previous);
    }
    await openDoc(docId);
  };
  const unsubscribeDoc = useDocumentStore.subscribe(() => void followDoc());
  void followDoc();

  return () => {
    unsubscribeAgent();
    unsubscribeDoc();
    loadToken++;
  };
};
