import type { PegoDocument } from "@pego/doc";
import type { Camera } from "@/canvas/types";
import type { PegoFileHandle } from "./fs-access";

const DB_NAME = "pego";
const STORE = "autosave";
const KEY = "current";

/** One open tab in the autosave. */
export type AutosavedTab = {
  doc: PegoDocument;
  fileName: string | null;
  handle: PegoFileHandle | null;
  bridgePath: string | null;
  dirty: boolean;
  /** Where the tab's view was (newer autosaves). */
  camera?: Camera;
  pageId?: string | null;
};

/**
 * One open document tab: a local document or a project. Older autosaves held several tabs per
 * workspace (the active one is restored) and called local tabs "scratch".
 */
export type AutosavedWorkspace = {
  id: string;
  name: string;
  dir: string | null;
  kind: "local" | "scratch" | "project";
  tabs: AutosavedTab[];
  activeIndex: number;
};

export type AutosaveRecord = {
  /** Every open tab in tab order (newest autosaves); `tabs` below then mirrors the live one. */
  workspaces?: AutosavedWorkspace[];
  /** Index of the shown tab in `workspaces`; -1 when none is open. */
  liveIndex?: number;
  view?: "dashboard" | "editor";
  /** Every open tab (newer autosaves). The top-level fields below describe the active one. */
  tabs?: AutosavedTab[];
  activeIndex?: number;
  doc: PegoDocument;
  fileName: string | null;
  /** True when the doc had unsaved changes relative to its file at write time. */
  dirty: boolean;
  /** Stored when the browser can structured-clone handles; permission is re-requested on save. */
  handle: PegoFileHandle | null;
  /** File on disk the bridge opened the document from (see useFileStore.bridgePath). */
  bridgePath?: string | null;
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
    // Handles may not be cloneable in every browser; retry without any.
    const withHandles =
      record.handle || record.workspaces?.some((w) => w.tabs.some((t) => t.handle));
    if (withHandles) {
      return writeAutosave({
        ...record,
        handle: null,
        tabs: record.tabs?.map((tab) => ({ ...tab, handle: null })),
        workspaces: record.workspaces?.map((workspace) => ({
          ...workspace,
          tabs: workspace.tabs.map((tab) => ({ ...tab, handle: null })),
        })),
      });
    }
    console.warn("autosave write failed", error);
  }
};
