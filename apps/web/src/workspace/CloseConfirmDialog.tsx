import { Button } from "@pego/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { dismissCloseConfirm, useCloseConfirm } from "./use-close-confirm";
import { forceCloseWorkspace, useWorkspaceStatus, useWorkspaceTitle } from "./use-workspace-store";

/** "Close <name>?" when a tab still has unsaved changes or a running agent. */
export const CloseConfirmDialog = () => {
  const { open, id } = useCloseConfirm();
  const name = useWorkspaceTitle(id ?? "");
  const { dirty, running } = useWorkspaceStatus(id ?? "");
  const reasons = [
    dirty ? "It has unsaved changes." : null,
    running ? "An agent is still working." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : dismissCloseConfirm())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {name || "this tab"}?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {reasons || "Closing it discards its current state."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={dismissCloseConfirm}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (id) forceCloseWorkspace(id);
              dismissCloseConfirm();
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
