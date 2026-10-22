import { create } from "zustand";
import type { PegoDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { isDirty } from "./file-format";
import type { PegoFileHandle } from "./fs-access";

type FileState = {
  /** Null until the document has been opened from / saved to a file. */
  fileName: string | null;
  handle: PegoFileHandle | null;
  /**
   * Absolute path of the file on disk when the document is a project's design or was opened or
   * saved through the local bridge (Claude Code's open_document / save_document). Save and auto
   * save write back there via the bridge.
   */
  bridgePath: string | null;
  /** The doc object at last save/open; null = unknown (restored unsaved work), always dirty. */
  savedDoc: PegoDocument | null;
  setSession: (
    session: Pick<FileState, "fileName" | "handle" | "savedDoc"> & { bridgePath?: string | null },
  ) => void;
  markSaved: (
    doc: PegoDocument,
    fileName: string | null,
    handle: PegoFileHandle | null,
    bridgePath?: string | null,
  ) => void;
};

export const useFileStore = create<FileState>((set) => ({
  fileName: null,
  handle: null,
  bridgePath: null,
  // The default document counts as clean at startup.
  savedDoc: useDocumentStore.getState().doc,
  setSession: (session) => set({ ...session, bridgePath: session.bridgePath ?? null }),
  markSaved: (doc, fileName, handle, bridgePath = null) =>
    set({ savedDoc: doc, fileName, handle, bridgePath }),
}));

export const useIsDirty = () => {
  const doc = useDocumentStore((s) => s.doc);
  const savedDoc = useFileStore((s) => s.savedDoc);
  return isDirty(doc, savedDoc);
};

export const getIsDirty = () =>
  isDirty(useDocumentStore.getState().doc, useFileStore.getState().savedDoc);
