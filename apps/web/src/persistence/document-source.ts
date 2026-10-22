import { saveFileViaBridge } from "@/agent/bridge-client";
import { writeToHandle } from "./file-permission";
import type { PegoFileHandle } from "./fs-access";

/**
 * Where the live document is saved. Two sources, one model:
 * - "file": a local .pego file through the File System Access API (the default; works offline),
 * - "bridge": a file on disk written by the local bridge (bridge projects' project.pego and files
 *   opened through the MCP open_document tool); needs a connected bridge.
 * "none": not saved anywhere yet (only the browser's IndexedDB autosave holds it).
 * A document has at most one: a local file handle wins over a bridge path.
 */
export type DocumentSource =
  | { kind: "file"; handle: PegoFileHandle; fileName: string }
  | { kind: "bridge"; path: string; fileName: string }
  | { kind: "none" };

type FileFields = {
  fileName: string | null;
  handle: PegoFileHandle | null;
  bridgePath: string | null;
};

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export const sourceOf = (file: FileFields): DocumentSource => {
  if (file.handle) {
    return { kind: "file", handle: file.handle, fileName: file.fileName ?? file.handle.name };
  }
  if (file.bridgePath) {
    return { kind: "bridge", path: file.bridgePath, fileName: baseName(file.bridgePath) };
  }
  return { kind: "none" };
};

/** Identity of a source: a write may only mark the document clean while this is unchanged. */
export const sourceKey = (source: DocumentSource): unknown =>
  source.kind === "file" ? source.handle : source.kind === "bridge" ? source.path : null;

/** The file-store fields that record a save to `source`. */
export const savedFields = (source: DocumentSource): FileFields =>
  source.kind === "file"
    ? { fileName: source.fileName, handle: source.handle, bridgePath: null }
    : source.kind === "bridge"
      ? { fileName: source.fileName, handle: null, bridgePath: source.path }
      : { fileName: null, handle: null, bridgePath: null };

/** Write the serialized document to its source. Rejects on failure (or with no source). */
export const writeToSource = async (source: DocumentSource, text: string): Promise<void> => {
  if (source.kind === "file") return writeToHandle(source.handle, text);
  if (source.kind === "bridge") return saveFileViaBridge(source.path, text);
  throw new Error("the document has no file to save to");
};
