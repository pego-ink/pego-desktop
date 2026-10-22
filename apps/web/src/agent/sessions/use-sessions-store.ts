import { create } from "zustand";
import type { SessionMeta } from "./session-model";

type SessionsState = {
  /** Design file the list belongs to (`doc.id`); null before the first document is known. */
  docId: string | null;
  /** Stored sessions of that file, newest first (the live session once it has a turn). */
  items: SessionMeta[];
};

export const useSessionsStore = create<SessionsState>(() => ({ docId: null, items: [] }));
