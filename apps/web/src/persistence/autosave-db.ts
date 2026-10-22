import type { PegoDocument } from "@pego/doc";
import type { PegoFileHandle } from "./fs-access";

const DB_NAME = "pego";
const STORE = "autosave";
const KEY = "current";

export type AutosaveRecord = {
  doc: PegoDocument;
  fileName: string | null;
  /** True when the doc had unsaved changes relative to its file at write time. */
  dirty: boolean;
  /** Stored when the browser can structured-clone handles; permission is re-requested on save. */
  handle: PegoFileHandle | null;
  savedAt: number;
};

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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

export const readAutosave = async (): Promise<AutosaveRecord | null> => {
  try {
    return ((await withStore("readonly", (s) => s.get(KEY))) as AutosaveRecord | undefined) ?? null;
  } catch (error) {
    console.warn("autosave read failed", error);
    return null;
  }
};

export const writeAutosave = async (record: AutosaveRecord): Promise<void> => {
  try {
    await withStore("readwrite", (s) => s.put(record, KEY));
  } catch (error) {
    // Handles may not be cloneable in every browser; retry without one.
    if (record.handle) return writeAutosave({ ...record, handle: null });
    console.warn("autosave write failed", error);
  }
};
