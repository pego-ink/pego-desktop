import { useDocumentStore } from "@/store/use-document-store";
import { isRunActive, isRunFinished } from "@/panels/agent/agent-format";
import { cancelAllRuns, cancelRun } from "@/agent/run";
import { runsForSession } from "@/agent/run-registry";
import {
  runningSessions,
  sessionOf,
  useAgentStore,
  visibleSession,
  type SessionLive,
} from "@/agent/use-agent-store";
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
 * Keeps the live agent sessions and IndexedDB in step. Each session is written on its own when
 * one of its runs starts (its prompt is stored, as cancelled until it ends), when it ends, and on
 * rename; never per token. Sessions with a run keep running (and saving) while another one is
 * shown. Opening or creating a design file shows that file's newest session.
 */

const agent = () => useAgentStore.getState();
const sessions = () => useSessionsStore.getState();
const liveOf = (id: string): SessionLive | undefined => agent().liveSessions[id];

/** Writes run one after another so an older snapshot never lands after a newer one. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

/** Bumped on every file change so a slow read for the previous file is dropped. */
let loadToken = 0;

const isEmpty = (live: SessionLive) =>
  live.turns.length === 0 && live.log.length === 0 && live.status === "idle";
const visibleIsEmpty = () => isEmpty(visibleSession(agent()));

const upsertMeta = (meta: SessionMeta, removed: readonly string[]) =>
  useSessionsStore.setState((state) => ({
    items: sortMetas([...state.items.filter((m) => m.id !== meta.id), meta]).filter(
      (m) => !removed.includes(m.id),
    ),
  }));

type Fingerprint = { turns: unknown; log: unknown; status: unknown; title: unknown };
/** What was last written per session, to skip writes when nothing changed (switching must not reorder). */
const saved = new Map<string, Fingerprint>();
const fingerprint = (live: SessionLive): Fingerprint => ({
  turns: live.turns,
  log: live.log,
  status: live.status,
  title: live.customTitle,
});
const markSaved = (id: string) => {
  const live = liveOf(id);
  if (live) saved.set(id, fingerprint(live));
};
/** Drop fingerprints of sessions that left memory. */
const forgetDropped = () => {
  for (const id of saved.keys()) if (!liveOf(id)) saved.delete(id);
};
const isDirty = (id: string) => {
  const live = liveOf(id);
  if (!live) return false;
  const was = saved.get(id);
  const now = fingerprint(live);
  return (
    !was ||
    was.turns !== now.turns ||
    was.log !== now.log ||
    was.status !== now.status ||
    was.title !== now.title
  );
};

/** Store a live session under `docId` (no-op while it has no turn). Snapshot is taken now. */
const saveLive = (docId: string, sessionId: string): Promise<void> => {
  const live = liveOf(sessionId);
  if (!live) return Promise.resolve();
  const session = sessionOf(live);
  if (session.turns.length === 0) return Promise.resolve();
  saved.set(sessionId, fingerprint(live));
  const stored = toStoredSession(session, docId, Date.now());
  if (useSessionsStore.getState().docId === docId) upsertMeta(metaOf(stored), []);
  return enqueue(async () => {
    const removed = await saveSession(stored);
    if (removed.length > 0 && sessions().docId === docId) upsertMeta(metaOf(stored), removed);
  });
};

/** Show an empty session next to whatever still runs in the background. */
const showFresh = () => {
  const fresh = emptySession();
  agent().showSession(fresh);
  markSaved(fresh.id);
  forgetDropped();
};

const anyRunning = (sessionId?: string) =>
  runningSessions(agent()).some((live) => sessionId === undefined || live.id === sessionId);

/** Resolves once no run is active (in `sessionId`, or anywhere); a cancelled API run ends asynchronously. */
const untilIdle = (sessionId?: string, timeoutMs = 3000): Promise<void> =>
  new Promise((resolve) => {
    if (!anyRunning(sessionId)) return resolve();
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsubscribe = useAgentStore.subscribe(() => {
      if (!anyRunning(sessionId)) done();
    });
  });

/** Open the design file `docId`: newest stored session, or an empty one. */
const openDoc = async (docId: string) => {
  const token = ++loadToken;
  useSessionsStore.setState({ docId, items: [] });
  const fresh = emptySession();
  agent().resetSessions(fresh);
  saved.clear();
  markSaved(fresh.id);
  const stored = await enqueue(() => listSessions(docId));
  if (token !== loadToken) return;
  useSessionsStore.setState({ items: sortMetas(stored.map(metaOf)) });
  const newest = stored[0];
  // A run started while the list was loading keeps the panel.
  if (!newest || !visibleIsEmpty()) return;
  agent().showSession(fromStoredSession(newest));
  markSaved(newest.id);
  forgetDropped();
};

const currentDocId = () => sessions().docId;

/** Start an empty session. The old one is stored first (and keeps running if it has a run). */
export const startNewSession = async (): Promise<void> => {
  const docId = currentDocId();
  if (!docId || visibleIsEmpty()) return;
  const current = agent().visibleSessionId;
  if (isDirty(current)) await saveLive(docId, current);
  if (docId !== currentDocId()) return;
  showFresh();
};

/** Show session `id` of the open file: from memory when it is live, else from storage. */
const showById = async (id: string, docId: string): Promise<void> => {
  const live = liveOf(id);
  if (live) {
    agent().showSession(live);
    forgetDropped();
    return;
  }
  const stored = await enqueue(() => getSession(id));
  if (!stored || stored.docId !== docId) {
    useSessionsStore.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }));
    return;
  }
  if (docId !== currentDocId()) return;
  agent().showSession(fromStoredSession(stored));
  markSaved(id);
  forgetDropped();
};

export const switchSession = async (id: string): Promise<void> => {
  const docId = currentDocId();
  const current = agent().visibleSessionId;
  if (!docId || id === current) return;
  if (isDirty(current)) await saveLive(docId, current);
  await showById(id, docId);
};

/** Delete a session; a run still working in it is stopped first. */
export const removeSession = async (id: string): Promise<void> => {
  // Stop it and let its end be written before the delete, so nothing writes it back afterwards.
  const runs = runsForSession(id);
  for (const run of runs) cancelRun(run.id);
  if (runs.length > 0) await untilIdle(id);

  useSessionsStore.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }));
  await enqueue(() => deleteSession(id));
  saved.delete(id);
  if (id !== agent().visibleSessionId) {
    agent().dropSession(id);
    return;
  }
  const next = sessions().items[0];
  const docId = currentDocId();
  // Not switchSession: that would first write the deleted session back.
  if (next && docId) await showById(next.id, docId);
  else showFresh();
  agent().dropSession(id);
};

/** Rename a session; an empty title goes back to the one derived from the first prompt. */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const docId = currentDocId();
  if (!docId) return;
  const custom = title.trim() || null;
  if (liveOf(id)) {
    agent().setSessionTitle(id, custom);
    await saveLive(docId, id);
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
    if (!docId || state.liveSessions === prev.liveSessions) return;
    // Every live session saves on its own run's start and end, shown or not.
    for (const live of Object.values(state.liveSessions)) {
      const before = prev.liveSessions[live.id];
      if (!before || before === live) continue;
      const started = live.log.length > 0 && before.log.length === 0 && isRunActive(live.status);
      const ended = isRunFinished(live.status) && !isRunFinished(before.status);
      if (started || ended) void saveLive(docId, live.id);
    }
  });

  let lastDocId: string | null = null;
  const followDoc = async () => {
    const docId = useDocumentStore.getState().doc.id;
    if (docId === lastDocId) return;
    const previous = lastDocId;
    lastDocId = docId;
    if (previous) {
      // The agents work on the open file; runs must not carry over to the next one. Their ends
      // are stored under the old file (the sessions store still points at it) before we move.
      cancelAllRuns();
      await untilIdle();
      if (lastDocId !== docId) return;
      for (const id of Object.keys(agent().liveSessions)) {
        if (isDirty(id)) await saveLive(previous, id);
      }
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
