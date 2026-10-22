/**
 * The user's Anthropic API key (BYOK), kept only in this browser's IndexedDB and sent only to
 * api.anthropic.com by the SDK. It lives in its own database ("pego-settings") so it never
 * shares a schema version with the autosave database ("pego"), whose open call pins version 1.
 * The key is never logged and never put in an error message.
 */
const DB_NAME = "pego-settings";
const DB_VERSION = 1;
const STORE = "settings";
const KEY = "anthropicApiKey";

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDb();
  try {
    return await request(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
};

/** Returns null when no key is saved or storage is unavailable (private mode, blocked). */
export const loadApiKey = async (): Promise<string | null> => {
  try {
    const value: unknown = await withStore("readonly", (store) => store.get(KEY));
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    // Deliberately no error detail: nothing about this call should risk leaking the key.
    return null;
  }
};

/** Saves the key (trimmed); `null` or an empty string removes it. Throws when storage fails. */
export const saveApiKey = async (key: string | null): Promise<void> => {
  const trimmed = key?.trim() ?? "";
  if (trimmed.length === 0) {
    await withStore("readwrite", (store) => store.delete(KEY));
    return;
  }
  await withStore("readwrite", (store) => store.put(trimmed, KEY));
};
