import { create } from "zustand";

/**
 * What the on-canvas text editor is working on.
 * - `edit`: an existing text node.
 * - `create`: a pending text node that is inserted only when confirmed with non-empty content.
 *   `x`/`y` are relative to `parentId` (null = document root), in document units.
 */
export type TextEditTarget =
  { mode: "edit"; id: string } | { mode: "create"; parentId: string | null; x: number; y: number };

type TextEditState = {
  target: TextEditTarget | null;
  /** Open the editor. The interaction layer calls this; the overlay owns confirm/cancel. */
  start: (target: TextEditTarget) => void;
  /** Close the editor without committing (the overlay commits before calling this). */
  stop: () => void;
};

export const useTextEditStore = create<TextEditState>((set) => ({
  target: null,
  start: (target) => set({ target }),
  stop: () => set({ target: null }),
}));

/** True while the text editor is open; keyboard shortcuts must not fire then. */
export const isTextEditing = () => useTextEditStore.getState().target !== null;
