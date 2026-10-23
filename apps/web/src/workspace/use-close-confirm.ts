import { create } from "zustand";
import { closeWorkspace, useWorkspaceStore } from "./use-workspace-store";

type CloseConfirmState = { open: boolean; id: string | null };

/** The tab waiting for the "close anyway?" answer. `id` stays while the dialog fades out. */
export const useCloseConfirm = create<CloseConfirmState>(() => ({ open: false, id: null }));

/** Close a tab, asking first when it has unsaved changes or a running agent. */
export const requestCloseTab = (id: string): void => {
  if (closeWorkspace(id) === "needs-confirm") useCloseConfirm.setState({ open: true, id });
};

export const dismissCloseConfirm = (): void => useCloseConfirm.setState({ open: false });

/**
 * Close a tab like `requestCloseTab`, and resolve once the answer is known: true when the tab is
 * gone (closed right away or after the user confirmed), false when the user kept it.
 */
export const closeTabAndWait = (id: string): Promise<boolean> =>
  new Promise((resolve) => {
    if (closeWorkspace(id) === "closed") return resolve(true);
    useCloseConfirm.setState({ open: true, id });
    // Confirming force-closes the tab before it dismisses the dialog, cancelling only dismisses.
    const unsubscribe = useCloseConfirm.subscribe((state) => {
      if (state.open) return;
      unsubscribe();
      resolve(!useWorkspaceStore.getState().workspaces.some((workspace) => workspace.id === id));
    });
  });
