import { DOCUMENT_VERSION, documentSchema, type PegoDocument } from "./schema";

type RawDocument = Record<string, unknown>;

/** `MIGRATIONS[v]` turns a version `v` document into version `v + 1`. Never edit a shipped step. */
const MIGRATIONS: Record<number, (doc: RawDocument) => RawDocument> = {
  // v1 only adds optional props (effects, per-side stroke, text spacing, path viewBox).
  0: (doc) => ({ ...doc, version: 1 }),
  // v2 adds pages: the old top-level nodes become the one and only page.
  1: (doc) => ({
    ...doc,
    version: 2,
    children: [
      {
        type: "page",
        id: uniquePageId(doc),
        name: "Page 1",
        children: Array.isArray(doc.children) ? doc.children : [],
      },
    ],
  }),
};

/** "page-1", or "page-1-2"... if a node already uses that id. */
const uniquePageId = (doc: RawDocument): string => {
  const taken = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) {
      const node = value as Record<string, unknown>;
      if (typeof node.id === "string") taken.add(node.id);
      walk(node.children);
    }
  };
  walk(doc.children);
  let id = "page-1";
  for (let n = 2; taken.has(id); n++) id = `page-1-${n}`;
  return id;
};

export type MigrationErrorCode = "not_a_document" | "unknown_version" | "newer_version";

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Upgrade raw document JSON (any version up to `DOCUMENT_VERSION`) to the current version,
 * step by step. The result still needs `documentSchema` validation. Throws `MigrationError`
 * for non-objects, missing/non-integer versions and documents from a newer Pego.
 */
export const migrateDocument = (raw: unknown): RawDocument => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MigrationError("not_a_document", "document must be an object");
  }
  let doc = raw as RawDocument;
  const version = doc.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new MigrationError(
      "unknown_version",
      `unknown document version ${JSON.stringify(version)}`,
    );
  }
  if (version > DOCUMENT_VERSION) {
    throw new MigrationError(
      "newer_version",
      `document version ${version} is newer than this Pego (${DOCUMENT_VERSION}); update Pego to open it`,
    );
  }
  for (let v = version; v < DOCUMENT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new MigrationError("unknown_version", `no migration from version ${v}`);
    doc = step(doc);
  }
  return doc;
};

/** Migrate and validate in one go. Returns null when the input cannot become a valid document. */
export const loadDocument = (raw: unknown): PegoDocument | null => {
  try {
    const result = documentSchema.safeParse(migrateDocument(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};
