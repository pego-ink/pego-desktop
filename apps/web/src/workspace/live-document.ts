import { emptyHistory, type History, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import type { Camera } from "@/canvas/types";
import { contentBounds } from "@/interaction/camera";
import { isDirty } from "@/persistence/file-format";
import type { PegoFileHandle } from "@/persistence/fs-access";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/**
 * The live document: the one the editor shows, held in the regular stores (document, file,
 * viewport) so the rest of the editor never deals with workspaces. Each workspace (a document tab:
 * a local document or a bridge project) has exactly one document; the background ones keep a
 * snapshot of this state, which agent runs keep editing (see document-target.ts).
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

let swapping = false;

/**
 * True while another tab's document is being put into the stores: store subscribers that react to
 * edits or file changes (autosave) must not mistake the swap for one.
 */
export const isSwapping = (): boolean => swapping;

/** Run a document swap (one tab's state replacing another's in the stores) flagged as such. */
export const swap = <T>(run: () => T): T => {
  const outer = swapping;
  swapping = true;
  try {
    return run();
  } finally {
    swapping = outer;
  }
};

export const restoreLive = (snapshot: DocumentSnapshot) =>
  swap(() => {
    const { doc, history, selection, pageId, camera, file } = snapshot;
    useDocumentStore.setState({ doc, history, selection, pageId, hoveredId: null });
    useFileStore.setState(file);
    useViewportStore.getState().setCamera(camera);
  });

/** A freshly opened document's state (no history yet; the camera is fitted once it is shown). */
export const snapshotOf = (
  doc: PegoDocument,
  file: Partial<Omit<DocumentFile, "savedDoc">>,
  saved: boolean,
): DocumentSnapshot => ({
  doc,
  history: emptyHistory(),
  selection: [],
  pageId: null,
  camera: useViewportStore.getState().camera,
  file: {
    fileName: file.fileName ?? null,
    handle: file.handle ?? null,
    bridgePath: file.bridgePath ?? null,
    savedDoc: saved ? doc : null,
  },
});

/** Fit the live document's first page into the view. */
export const fitLive = (): void => {
  const { doc } = useDocumentStore.getState();
  useViewportStore.getState().zoomToFit(contentBounds(doc, getLayout(doc)));
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
