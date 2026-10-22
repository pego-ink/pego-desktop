import { create } from "zustand";
import { sampleDoc, type PegoDocument } from "@pego/doc";

type DocumentState = {
  doc: PegoDocument;
  setDoc: (doc: PegoDocument) => void;
};

export const useDocumentStore = create<DocumentState>((set) => ({
  doc: sampleDoc,
  setDoc: (doc) => set({ doc }),
}));
