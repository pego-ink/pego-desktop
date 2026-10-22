import { createId, documentSchema, type PegoDocument } from "@pego/doc";

export const FILE_FORMAT = "pego";
export const FILE_VERSION = 0;
export const FILE_EXTENSION = ".pego";
export const FILE_MIME = "application/json";
export const DEFAULT_FILE_NAME = `Untitled${FILE_EXTENSION}`;

export const serializeDocument = (doc: PegoDocument): string =>
  JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, document: doc }, null, 2);

export class FileFormatError extends Error {}

const MAX_ISSUES = 3;

/** Parse and validate the text of a `.pego` file. Throws `FileFormatError` with a readable message. */
export const parseDocumentFile = (text: string): PegoDocument => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError("Not a valid Pego file: the content is not valid JSON.");
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { format?: unknown }).format !== FILE_FORMAT
  ) {
    throw new FileFormatError('Not a Pego file: missing "format": "pego".');
  }
  const { version, document } = raw as { version?: unknown; document?: unknown };
  if (version !== FILE_VERSION) {
    throw new FileFormatError(
      `Unsupported Pego file version ${JSON.stringify(version)} (expected ${FILE_VERSION}).`,
    );
  }
  const result = documentSchema.safeParse(document);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
    .join("; ");
  const more = result.error.issues.length - MAX_ISSUES;
  throw new FileFormatError(
    `Invalid Pego document: ${issues}${more > 0 ? ` (+${more} more)` : ""}`,
  );
};

/** A new empty document: one 1440x1024 white frame named "Frame". */
export const createEmptyDocument = (): PegoDocument =>
  documentSchema.parse({
    version: 0,
    id: createId(),
    name: "Untitled",
    children: [
      {
        id: createId(),
        type: "frame",
        name: "Frame",
        x: 0,
        y: 0,
        width: 1440,
        height: 1024,
        fill: "#FFFFFF",
      },
    ],
  });

/** Dirty means the live doc object differs from the one at last save/open (`null` = never saved state). */
export const isDirty = (doc: PegoDocument, savedDoc: PegoDocument | null): boolean =>
  doc !== savedDoc;
