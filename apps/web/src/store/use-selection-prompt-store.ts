import { create } from "zustand";

type SelectionPromptState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

/** Whether the floating "ask Pego about the selection" box is open. */
export const useSelectionPrompt = create<SelectionPromptState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
