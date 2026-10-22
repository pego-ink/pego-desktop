import { createId, importPen, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { contentBounds } from "@/interaction/camera";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { FILE_EXTENSION, parseDocumentFile, serializeDocument } from "./file-format";
import { getIsDirty, useFileStore } from "./use-file-store";

/**
 * Editor side of the bridge's file tools (open_document / save_document): the bridge reads and
 * writes the bytes on disk, the editor parses, shows and serializes the document.
 */

export type OpOutcome = { content: string; isError: boolean };

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const zoomToDocument = (doc: PegoDocument) =>
  useViewportStore.getState().zoomToFit(contentBounds(doc, getLayout(doc)));

const describe = (doc: PegoDocument) => {
  const frames = doc.children.map((node) => node.name ?? node.type).slice(0, 8);
  const more = doc.children.length - frames.length;
  return `${doc.children.length} top-level node(s)${frames.length ? `: ${frames.join(", ")}${more > 0 ? `, +${more} more` : ""}` : ""}`;
};

export const loadDocumentFromBridge = (input: unknown): OpOutcome => {
  if (!isObject(input) || typeof input.text !== "string" || typeof input.path !== "string") {
    return { content: "Invalid load request.", isError: true };
  }
  const { text, path } = input;
  const discardUnsaved = input.discardUnsaved === true;
  const files = useFileStore.getState();
  if (getIsDirty() && !discardUnsaved) {
    return {
      content: `The open document "${files.fileName ?? "Untitled"}" has unsaved changes. Save it with save_document first, or pass discardUnsaved: true to replace it.`,
      isError: true,
    };
  }
  const name = fileNameOf(path);
  try {
    if (path.toLowerCase().endsWith(".pen")) {
      const base = name.replace(/\.pen$/i, "");
      const { doc, warnings } = importPen(JSON.parse(text), base);
      useDocumentStore.getState().load(doc);
      // The .pen file is never written; saving goes to a .pego next to it.
      const target = path.replace(/\.pen$/i, FILE_EXTENSION);
      files.setSession({
        fileName: `${base}${FILE_EXTENSION}`,
        handle: null,
        savedDoc: null,
        bridgePath: target,
      });
      zoomToDocument(doc);
      const notes = warnings.map((w) => `- ${w.message}${w.count > 1 ? ` (${w.count}x)` : ""}`);
      return {
        content: [
          `Imported ${name} (${describe(doc)}). It is unsaved; save_document writes ${target}.`,
          ...(notes.length > 0 ? ["Not converted:", ...notes] : []),
        ].join("\n"),
        isError: false,
      };
    }
    const doc = parseDocumentFile(text);
    useDocumentStore.getState().load(doc);
    files.markSaved(useDocumentStore.getState().doc, name, null, path);
    zoomToDocument(doc);
    return { content: `Opened ${path} (${describe(doc)}).`, isError: false };
  } catch (error) {
    return {
      content: `Could not open ${name}: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};

/** The last snapshot handed to the bridge, so mark_saved records exactly what was written. */
let pendingSnapshot: { id: string; doc: PegoDocument } | null = null;

export const snapshotDocumentForBridge = (): OpOutcome => {
  const doc = useDocumentStore.getState().doc;
  const { fileName, bridgePath } = useFileStore.getState();
  pendingSnapshot = { id: createId(), doc };
  return {
    content: JSON.stringify({
      text: serializeDocument(doc),
      path: bridgePath,
      name: fileName,
      snapshotId: pendingSnapshot.id,
    }),
    isError: false,
  };
};

export const markSavedFromBridge = (input: unknown): OpOutcome => {
  if (
    !isObject(input) ||
    typeof input.path !== "string" ||
    !pendingSnapshot ||
    pendingSnapshot.id !== input.snapshotId
  ) {
    return { content: "No matching snapshot to mark as saved.", isError: true };
  }
  const { doc } = pendingSnapshot;
  pendingSnapshot = null;
  useFileStore.getState().markSaved(doc, fileNameOf(input.path), null, input.path);
  return { content: "ok", isError: false };
};
