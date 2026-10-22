import { create } from "zustand";
import type { PegoDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
import { isDirty } from "./file-format";
import type { PegoFileHandle } from "./fs-access";

type FileState = {
  /** Null until the document has been opened from / saved to a file. */
  fileName: string | null;
  handle: PegoFileHandle | null;
  /** The doc object at last save/open; null = unknown (restored unsaved work), always dirty. */
  savedDoc: PegoDocument | null;
  setSession: (session: Pick<FileState, "fileName" | "handle" | "savedDoc">) => void;
  markSaved: (doc: PegoDocument, fileName: string | null, handle: PegoFileHandle | null) => void;
};

export const useFileStore = create<FileState>((set) => ({
  fileName: null,
  handle: null,
  // The default document counts as clean at startup.
  savedDoc: useDocumentStore.getState().doc,
  setSession: (session) => set(session),
  markSaved: (doc, fileName, handle) => set({ savedDoc: doc, fileName, handle }),
}));

export const useIsDirty = () => {
  const doc = useDocumentStore((s) => s.doc);
  const savedDoc = useFileStore((s) => s.savedDoc);
  return isDirty(doc, savedDoc);
};

export const getIsDirty = () =>
  isDirty(useDocumentStore.getState().doc, useFileStore.getState().savedDoc);
