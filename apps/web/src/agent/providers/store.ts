import type { CustomProvider, CustomProviderKind } from "./types";

/**
 * Custom providers + their API keys, kept only in this browser (IndexedDB "pego-settings", the
 * same database as the Anthropic key in ../api-key.ts). Keys are sent only to the provider's own
 * base URL and are never logged or put in an error message.
 *
 * Storage goes through a tiny key-value backend so tests can swap in an in-memory map.
 */
const DB_NAME = "pego-settings";
/** v1 had only "settings"; v2 adds the provider stores. Upgrade never touches existing stores. */
const DB_VERSION = 2;
const STORES = ["settings", "providers", "providerKeys"] as const;
type StoreName = (typeof STORES)[number];

export type StoreBackend = {
  get: (store: StoreName, key: string) => Promise<unknown>;
  getAll: (store: StoreName) => Promise<unknown[]>;
  put: (store: StoreName, key: string, value: unknown) => Promise<void>;
  remove: (store: StoreName, key: string) => Promise<void>;
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
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const withStore = async <T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const db = await openDb();
  try {
    return await request(run(db.transaction(name, mode).objectStore(name)));
  } finally {
    db.close();
  }
};

const indexedDbBackend: StoreBackend = {
  get: (store, key) => withStore(store, "readonly", (s) => s.get(key)),
  getAll: (store) => withStore(store, "readonly", (s) => s.getAll()),
  put: async (store, key, value) => {
    await withStore(store, "readwrite", (s) => s.put(value, key));
  },
  remove: async (store, key) => {
    await withStore(store, "readwrite", (s) => s.delete(key));
  },
};

/** In-memory backend (tests, or a fallback where IndexedDB is unavailable). */
export const createMemoryBackend = (): StoreBackend => {
  const data = new Map<StoreName, Map<string, unknown>>();
  const table = (name: StoreName) => {
    const existing = data.get(name);
    if (existing) return existing;
    const created = new Map<string, unknown>();
    data.set(name, created);
    return created;
  };
  return {
    get: async (store, key) => table(store).get(key),
    getAll: async (store) => [...table(store).values()],
    put: async (store, key, value) => {
      table(store).set(key, structuredClone(value));
    },
    remove: async (store, key) => {
      table(store).delete(key);
    },
  };
};

let backend: StoreBackend = indexedDbBackend;

/** Test hook: `null` restores IndexedDB. */
export const setStoreBackend = (next: StoreBackend | null) => {
  backend = next ?? indexedDbBackend;
};

// ---- validation ----------------------------------------------------------------------------

export class ProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderValidationError";
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Normalize and validate a base URL: https required, except http://localhost and
 * http://127.0.0.1 (local servers). No credentials, query or fragment. Trailing slashes are
 * dropped. Throws ProviderValidationError.
 */
export const normalizeBaseUrl = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProviderValidationError("Base URL is not a valid URL.");
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new ProviderValidationError(
      "Base URL must use https (http is only allowed for localhost and 127.0.0.1).",
    );
  }
  if (url.username || url.password) {
    throw new ProviderValidationError("Base URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new ProviderValidationError("Base URL must not contain a query or fragment.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
};

const KINDS: readonly CustomProviderKind[] = ["openai-compatible", "anthropic-compatible"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredText = (value: unknown, label: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) throw new ProviderValidationError(`${label} is required.`);
  return text;
};

/** Validate untrusted input (the settings form, or data read back from storage). */
export const parseCustomProvider = (input: unknown): CustomProvider => {
  if (!isRecord(input)) throw new ProviderValidationError("Provider is not an object.");
  const kind = KINDS.find((candidate) => candidate === input.kind);
  if (!kind) throw new ProviderValidationError("Provider kind is not supported.");
  const models = Array.isArray(input.models)
    ? [
        ...new Set(
          input.models.flatMap((model) =>
            typeof model === "string" && model.trim() ? [model.trim()] : [],
          ),
        ),
      ]
    : [];
  const plannerModel =
    typeof input.plannerModel === "string" && input.plannerModel.trim()
      ? input.plannerModel.trim()
      : undefined;
  return {
    id: requiredText(input.id, "Provider id"),
    name: requiredText(input.name, "Name"),
    kind,
    baseUrl: normalizeBaseUrl(typeof input.baseUrl === "string" ? input.baseUrl : ""),
    models,
    ...(plannerModel ? { plannerModel } : {}),
    executorModel: requiredText(input.executorModel, "Executor model"),
    createdAt:
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? input.createdAt
        : Date.now(),
  };
};

// ---- public API ----------------------------------------------------------------------------

/** All saved providers, oldest first. Unreadable rows are skipped; storage failure gives []. */
export const listCustomProviders = async (): Promise<CustomProvider[]> => {
  try {
    const rows = await backend.getAll("providers");
    return rows
      .flatMap((row) => {
        try {
          return [parseCustomProvider(row)];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
};

/** Validates, then stores (upsert by id). Throws ProviderValidationError or a storage error. */
export const saveCustomProvider = async (provider: CustomProvider): Promise<void> => {
  const valid = parseCustomProvider(provider);
  await backend.put("providers", valid.id, valid);
};

/** Removes the provider and its key. */
export const deleteCustomProvider = async (id: string): Promise<void> => {
  await backend.remove("providers", id);
  await backend.remove("providerKeys", id);
};

/** Null when no key is saved or storage is unavailable. No error detail, by design. */
export const loadProviderKey = async (id: string): Promise<string | null> => {
  try {
    const value = await backend.get("providerKeys", id);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

/** Saves the key (trimmed); `null` or an empty string removes it. Throws when storage fails. */
export const saveProviderKey = async (id: string, key: string | null): Promise<void> => {
  const trimmed = key?.trim() ?? "";
  if (trimmed.length === 0) {
    await backend.remove("providerKeys", id);
    return;
  }
  await backend.put("providerKeys", id, trimmed);
};
