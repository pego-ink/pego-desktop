import { toast } from "sonner";
import type { History, PegoDocument } from "@pego/doc";
import { selectRunsActive, useAgentStore } from "@/agent/use-agent-store";
import { getLayout } from "@/canvas/layout";
import type { Camera } from "@/canvas/types";
import { contentBounds } from "@/interaction/camera";
import { createEmptyDocument, isDirty } from "@/persistence/file-format";
import type { PegoFileHandle } from "@/persistence/fs-access";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/**
 * The live document: the one the editor shows, held in the regular stores (document, file,
 * viewport) so the rest of the editor never deals with workspaces. Each workspace (scratch or a
 * bridge project) has exactly one document; the inactive ones keep a snapshot of this state.
 */

/** Where the document saves (see persistence/document-source.ts) and what was saved last. */
export type DocumentFile = {
  fileName: string | null;
  handle: PegoFileHandle | null;
  bridgePath: string | null;
  savedDoc: PegoDocument | null;
};

export type DocumentSnapshot = {
  doc: PegoDocument;
  history: History;
  selection: string[];
  pageId: string | null;
  camera: Camera;
  file: DocumentFile;
};

/** The live state of the shown document. */
export const captureLive = (): DocumentSnapshot => {
  const { doc, history, selection, pageId } = useDocumentStore.getState();
  const { fileName, handle, bridgePath, savedDoc } = useFileStore.getState();
  return {
    doc,
    history,
    selection,
    pageId,
    camera: useViewportStore.getState().camera,
    file: { fileName, handle, bridgePath, savedDoc },
  };
};

export const restoreLive = (snapshot: DocumentSnapshot) => {
  const { doc, history, selection, pageId, camera, file } = snapshot;
  useDocumentStore.setState({ doc, history, selection, pageId, hoveredId: null });
  useFileStore.setState(file);
  useViewportStore.getState().setCamera(camera);
};

export const snapshotIsDirty = (snapshot: DocumentSnapshot): boolean =>
  isDirty(snapshot.doc, snapshot.file.savedDoc);

/** File name of a project's design (one per project folder). */
export const PROJECT_DESIGN_FILE = "project.pego";

export const isProjectDesign = (bridgePath: string | null): boolean =>
  bridgePath !== null && /[\\/]project\.pego$/i.test(bridgePath);

/**
 * What a document is called in the header and the workspace tabs: a project's design shows the
 * project (its document name), other files their file name, new documents "Untitled".
 */
export const documentTitle = (
  doc: PegoDocument,
  file: Pick<DocumentFile, "fileName" | "bridgePath">,
): string => (isProjectDesign(file.bridgePath) ? doc.name : (file.fileName ?? "Untitled"));

/** A run of the panel agent edits the live document: replacing it mid-run is not allowed. */
export const blockedByRun = (): boolean => {
  if (selectRunsActive(useAgentStore.getState()) === 0) return false;
  toast.info("Wait for the agent run to finish (or stop it) before switching documents.");
  return true;
};

let beforeSwap: () => void = () => {};

/**
 * Called right before another workspace's document replaces the live one, while the outgoing one
 * is still in the stores. File autosave registers here to write a pending change before it is
 * swapped out (opening another document in the same workspace asks about unsaved changes instead).
 */
export const setBeforeSwap = (hook: () => void): void => {
  beforeSwap = hook;
};
export const runBeforeSwap = (): void => beforeSwap();

/** What to do when the shown document has unsaved changes and another one should replace it. */
export type UnsavedPolicy = "ask" | "refuse" | "discard";
export type OpenResult = "opened" | "busy" | "unsaved";

/** Put a document into the live stores, fitted to the view. */
export const loadIntoActive = (
  doc: PegoDocument,
  file: Partial<Omit<DocumentFile, "savedDoc">>,
  saved: boolean,
) => {
  useDocumentStore.getState().load(doc);
  const loaded = useDocumentStore.getState().doc;
  useFileStore.setState({
    fileName: file.fileName ?? null,
    handle: file.handle ?? null,
    bridgePath: file.bridgePath ?? null,
    savedDoc: saved ? loaded : null,
  });
  useViewportStore.getState().zoomToFit(contentBounds(loaded, getLayout(loaded)));
};

/**
 * Show `doc` as the workspace's document (there is one per workspace; screens are pages).
 * Unsaved changes of the current document are asked about ("ask", the user), refused
 * ("refuse", Claude Code: save first) or dropped ("discard"). `saved` marks `doc` as matching
 * its file.
 */
export const openDocument = (
  doc: PegoDocument,
  file: Partial<Omit<DocumentFile, "savedDoc">>,
  options: { saved?: boolean; unsaved?: UnsavedPolicy } = {},
): OpenResult => {
  if (blockedByRun()) return "busy";
  const live = captureLive();
  if (snapshotIsDirty(live)) {
    const policy = options.unsaved ?? "ask";
    if (policy === "refuse") return "unsaved";
    if (
      policy === "ask" &&
      !window.confirm(
        `"${documentTitle(live.doc, live.file)}" has unsaved changes. Open the other document anyway?`,
      )
    ) {
      return "unsaved";
    }
  }
  loadIntoActive(doc, file, options.saved ?? true);
  return "opened";
};

/** A new empty document in place of the current one (asking about unsaved changes). */
export const openNewDocument = (): OpenResult =>
  openDocument(createEmptyDocument(), {}, { saved: true });
