import { useState } from "react";
import { Button } from "@pego/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { dismissCloseConfirm, saveAndCloseTab, useCloseConfirm } from "./use-close-confirm";
import { forceCloseWorkspace, useWorkspaceStatus, useWorkspaceTitle } from "./use-workspace-store";

/** "Close <name>?" when a tab still has unsaved changes or a running agent. */
export const CloseConfirmDialog = () => {
  const { open, id } = useCloseConfirm();
  const name = useWorkspaceTitle(id ?? "");
  const { dirty, running } = useWorkspaceStatus(id ?? "");
  const [saving, setSaving] = useState(false);
  const reasons = [
    dirty ? "It has unsaved changes." : null,
    running ? "An agent is still working." : null,
  ]
    .filter(Boolean)
    .join(" ");

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await saveAndCloseTab(id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next || saving ? undefined : dismissCloseConfirm())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {name || "this tab"}?</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            {reasons || "Closing it discards its current state."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={saving} onClick={dismissCloseConfirm}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (id) forceCloseWorkspace(id);
              dismissCloseConfirm();
            }}
          >
            {dirty ? "Don't save" : "Close"}
          </Button>
          {dirty ? (
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
