import {
  metaOf,
  prunedIds,
  SESSION_LIMITS,
  type SessionMeta,
  type StoredSession,
} from "./session-model";

/**
 * Chat sessions per design file, kept only in this browser (IndexedDB "pego-sessions", store
 * "sessions" keyed by session id, index "byDoc" on `docId`). Not part of the .pego file.
 * Storage goes through a small backend so tests can swap in an in-memory map.
 */
const DB_NAME = "pego-sessions";
const DB_VERSION = 1;
const STORE = "sessions";
const DOC_INDEX = "byDoc";

export type SessionBackend = {
  listByDoc: (docId: string) => Promise<StoredSession[]>;
  get: (id: string) => Promise<StoredSession | undefined>;
  put: (session: StoredSession) => Promise<void>;
  remove: (ids: readonly string[]) => Promise<void>;
};

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex(DOC_INDEX, "docId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const withDb = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const result = run(tx.objectStore(STORE));
    const value = await (result instanceof IDBRequest ? request(result) : result);
    if (mode === "readwrite") {
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    return value;
  } finally {
    db.close();
  }
};

const indexedDbBackend: SessionBackend = {
  listByDoc: (docId) =>
    withDb("readonly", (s) => s.index(DOC_INDEX).getAll(docId) as IDBRequest<StoredSession[]>),
  get: (id) => withDb("readonly", (s) => s.get(id) as IDBRequest<StoredSession | undefined>),
  put: async (session) => {
    await withDb("readwrite", (s) => s.put(session));
  },
  remove: async (ids) => {
    await withDb("readwrite", async (s) => {
      await Promise.all(ids.map((id) => request(s.delete(id))));
    });
  },
};

/** In-memory backend (tests, or a fallback where IndexedDB is unavailable). */
export const createMemorySessionBackend = (): SessionBackend => {
  const data = new Map<string, StoredSession>();
  return {
    listByDoc: async (docId) =>
      [...data.values()].filter((s) => s.docId === docId).map((s) => structuredClone(s)),
    get: async (id) => {
      const found = data.get(id);
      return found ? structuredClone(found) : undefined;
    },
    put: async (session) => {
      data.set(session.id, structuredClone(session));
    },
    remove: async (ids) => {
      for (const id of ids) data.delete(id);
    },
  };
};

let backend: SessionBackend = indexedDbBackend;

/** Tests inject a memory backend; returns the previous one. */
export const setSessionBackend = (next: SessionBackend): SessionBackend => {
  const previous = backend;
  backend = next;
  return previous;
};

/** Sessions of one design file, newest first. Storage failures read as "no sessions". */
export const listSessions = async (docId: string): Promise<StoredSession[]> => {
  try {
    return (await backend.listByDoc(docId)).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.warn("sessions read failed", error);
    return [];
  }
};

export const getSession = async (id: string): Promise<StoredSession | null> => {
  try {
    return (await backend.get(id)) ?? null;
  } catch (error) {
    console.warn("session read failed", error);
    return null;
  }
};

/**
 * Write one session, then prune the file's sessions to the newest `maxPerDoc`.
 * Resolves to the pruned ids; never throws (a failed write only costs history).
 */
export const saveSession = async (
  session: StoredSession,
  max: number = SESSION_LIMITS.maxPerDoc,
): Promise<string[]> => {
  try {
    await backend.put(session);
    const metas: SessionMeta[] = (await backend.listByDoc(session.docId)).map(metaOf);
    const stale = prunedIds(metas, max);
    if (stale.length > 0) await backend.remove(stale);
    return stale;
  } catch (error) {
    console.warn("session write failed", error);
    return [];
  }
};

export const deleteSession = async (id: string): Promise<void> => {
  try {
    await backend.remove([id]);
  } catch (error) {
    console.warn("session delete failed", error);
  }
};

/**
 * Re-key every session of `fromDocId` to `toDocId` (a document that became a project keeps its
 * chats). Resolves to the moved ids; never throws (a failed move only costs history).
 */
export const moveSessions = async (fromDocId: string, toDocId: string): Promise<string[]> => {
  try {
    const sessions = await backend.listByDoc(fromDocId);
    for (const session of sessions) await backend.put({ ...session, docId: toDocId });
    return sessions.map((session) => session.id);
  } catch (error) {
    console.warn("sessions move failed", error);
    return [];
  }
};
