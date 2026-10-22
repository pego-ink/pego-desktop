import { useDocumentStore } from "@/store/use-document-store";
import { isRunActive, isRunFinished } from "@/panels/agent/agent-format";
import { cancelRun } from "@/agent/run";
import { startQueueDriver } from "@/agent/queue";
import { allRuns, runsForSession } from "@/agent/run-registry";
import { readTarget } from "@/workspace/document-target";
import { isSwapping } from "@/workspace/live-document";
import { useWorkspaceStore } from "@/workspace/use-workspace-store";
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
  type SessionState,
} from "./session-model";
import { forgetSessionHome, sessionHome, setSessionHome } from "./session-home";
import { useSessionsStore } from "./use-sessions-store";

/**
 * Keeps the live agent sessions and IndexedDB in step. Each session is written on its own when
 * one of its runs starts (its prompt is stored, as cancelled until it ends), when it ends, and on
 * rename; never per token. Sessions with a run keep running (and saving) while another one is
 * shown, and while another tab is shown: each session belongs to its tab's document (see
 * session-home), the panel lists the shown document's sessions. Showing a tab shows the session it
 * showed last (or one still running in it); opening or creating a design file shows that file's
 * newest session.
 */

const agent = () => useAgentStore.getState();
const sessions = () => useSessionsStore.getState();
const liveOf = (id: string): SessionLive | undefined => agent().liveSessions[id];

/** The tab and document shown in the editor. */
type Visible = { workspaceId: string; docId: string };
/** `workspaceId` of the document shown while no tab is open. */
const NO_TAB = "";
const visibleNow = (): Visible => ({
  workspaceId: useWorkspaceStore.getState().liveId ?? NO_TAB,
  docId: useDocumentStore.getState().doc.id,
});
const sameVisible = (a: Visible, b: Visible) =>
  a.workspaceId === b.workspaceId && a.docId === b.docId;
/** The document a live session stores under: its home, else the one shown. */
const docOf = (sessionId: string): string | null =>
  sessionHome(sessionId)?.docId ?? sessions().docId;
const homeHere = (sessionId: string) => setSessionHome(sessionId, visibleNow());

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

type Fingerprint = {
  turns: unknown;
  log: unknown;
  status: unknown;
  title: unknown;
  queue: unknown;
};
/** What was last written per session, to skip writes when nothing changed (switching must not reorder). */
const saved = new Map<string, Fingerprint>();
const fingerprint = (live: SessionLive): Fingerprint => ({
  turns: live.turns,
  log: live.log,
  status: live.status,
  title: live.customTitle,
  queue: live.queue,
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
    was.title !== now.title ||
    was.queue !== now.queue
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
  homeHere(fresh.id);
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

/** The session each tab showed last, shown again when the tab comes back. */
const lastShown = new Map<string, { docId: string; sessionId: string }>();

/** Show a session of the visible document (from memory or storage) in the panel. */
const showHere = (session: SessionState) => {
  homeHere(session.id);
  const wasLive = liveOf(session.id) !== undefined;
  agent().showSession(session);
  if (!wasLive) markSaved(session.id);
  forgetDropped();
};

/**
 * Sessions nobody can reach any more leave memory: not shown, nothing running or queued, and
 * their tab closed (or holding another document).
 */
const pruneOrphans = () => {
  const { visibleSessionId, liveSessions } = agent();
  for (const live of Object.values(liveSessions)) {
    if (live.id === visibleSessionId || isRunActive(live.status) || live.queue.length > 0) continue;
    const home = sessionHome(live.id);
    if (!home || readTarget(home)) continue;
    agent().dropSession(live.id);
    forgetSessionHome(live.id);
  }
  forgetDropped();
};

/**
 * Show the chats of the visible document: a session still in memory for it (the one it showed
 * last, or one running), else the one it showed last or its newest from storage, else an empty one.
 */
const openVisible = async (visible: Visible) => {
  const { workspaceId, docId } = visible;
  const token = ++loadToken;
  useSessionsStore.setState({ docId, items: [] });
  const remembered = lastShown.get(workspaceId);
  const rememberedId = remembered?.docId === docId ? remembered.sessionId : undefined;
  const here = Object.values(agent().liveSessions).filter((live) => {
    const home = sessionHome(live.id);
    return home !== undefined && sameVisible(home, visible);
  });
  const inMemory = here.find((live) => live.id === rememberedId) ?? here[0];
  if (inMemory) showHere(inMemory);
  else showFresh();
  pruneOrphans();
  const stored = await enqueue(() => listSessions(docId));
  if (token !== loadToken) return;
  useSessionsStore.setState({ items: sortMetas(stored.map(metaOf)) });
  if (inMemory) return;
  const pick = stored.find((item) => item.id === rememberedId) ?? stored[0];
  // A run started while the list was loading keeps the panel.
  if (!pick || !visibleIsEmpty()) return;
  showHere(fromStoredSession(pick));
};

const currentDocId = () => sessions().docId;

/**
 * Create an empty session for the open file without showing it: it is live (a run can start in it
 * with `submitPrompt`) and appears in the session list once that run starts. Returns its id.
 */
export const createSessionInBackground = (): string => {
  const fresh = emptySession();
  homeHere(fresh.id);
  agent().addSession(fresh);
  markSaved(fresh.id);
  return fresh.id;
};

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
    showHere(live);
    return;
  }
  const stored = await enqueue(() => getSession(id));
  if (!stored || stored.docId !== docId) {
    useSessionsStore.setState((s) => ({ items: s.items.filter((m) => m.id !== id) }));
    return;
  }
  if (docId !== currentDocId()) return;
  showHere(fromStoredSession(stored));
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
  forgetSessionHome(id);
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
    if (state.liveSessions === prev.liveSessions) return;
    // Every live session saves on its own run's start and end, shown or not, under its document.
    for (const live of Object.values(state.liveSessions)) {
      const before = prev.liveSessions[live.id];
      if (!before || before === live) continue;
      const started = live.log.length > 0 && before.log.length === 0 && isRunActive(live.status);
      const ended = isRunFinished(live.status) && !isRunFinished(before.status);
      const queueChanged = live.queue !== before.queue;
      const docId = docOf(live.id);
      if (docId && (started || ended || queueChanged)) void saveLive(docId, live.id);
    }
  });

  let last: Visible | null = null;
  const followVisible = async () => {
    // Mid-swap the stores hold half of the next tab; the tab change that follows calls again.
    if (isSwapping()) return;
    const visible = visibleNow();
    if (last && sameVisible(last, visible)) return;
    const previous = last;
    last = visible;
    if (previous) {
      lastShown.set(previous.workspaceId, {
        docId: previous.docId,
        sessionId: agent().visibleSessionId,
      });
      // Runs keep working in their own tab. Only a run whose document is gone (replaced in its
      // tab) stops; its end is stored under that document before we move on.
      const orphaned = allRuns().filter((run) => run.host.target && !readTarget(run.host.target));
      for (const run of orphaned) cancelRun(run.id);
      for (const run of orphaned) await untilIdle(run.sessionId);
      if (!sameVisible(last, visible)) return;
      for (const id of Object.keys(agent().liveSessions)) {
        const docId = docOf(id);
        if (docId === previous.docId && isDirty(id)) await saveLive(docId, id);
      }
      if (!sameVisible(last, visible)) return;
    }
    await openVisible(visible);
  };
  const unsubscribeDoc = useDocumentStore.subscribe((state, prev) => {
    if (state.doc.id !== prev.doc.id) void followVisible();
  });
  const unsubscribeTabs = useWorkspaceStore.subscribe((state, prev) => {
    if (state.liveId !== prev.liveId) void followVisible();
  });
  void followVisible();
  // A finished run starts the first message queued behind it.
  const stopQueueDriver = startQueueDriver();

  return () => {
    stopQueueDriver();
    unsubscribeAgent();
    unsubscribeDoc();
    unsubscribeTabs();
    loadToken++;
  };
};
