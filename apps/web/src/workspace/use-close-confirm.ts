import { create } from "zustand";
import { closeWorkspace } from "./use-workspace-store";

type CloseConfirmState = { open: boolean; id: string | null };

/** The tab waiting for the "close anyway?" answer. `id` stays while the dialog fades out. */
export const useCloseConfirm = create<CloseConfirmState>(() => ({ open: false, id: null }));

/** Close a tab, asking first when it has unsaved changes or a running agent. */
export const requestCloseTab = (id: string): void => {
  if (closeWorkspace(id) === "needs-confirm") useCloseConfirm.setState({ open: true, id });
};

export const dismissCloseConfirm = (): void => useCloseConfirm.setState({ open: false });
