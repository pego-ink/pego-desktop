import { useState } from "react";
import { create } from "zustand";
import { Button } from "@pego/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { Input } from "@pego/ui/components/input";
import { Spinner } from "@pego/ui/components/spinner";
import { useDocumentStore } from "@/store/use-document-store";
import { canSaveAsProject, saveAsProject } from "./save-as-project";

/** `name` is filled when the dialog opens: the document's name, when it has one. */
export const useSaveAsProjectDialog = create<{
  open: boolean;
  name: string;
  setOpen: (open: boolean) => void;
  setName: (name: string) => void;
}>((set) => ({
  open: false,
  name: "",
  setOpen: (open) => set({ open }),
  setName: (name) => set({ name }),
}));

/** File › Save as project…: opens the name dialog when the bridge can create projects. */
export const openSaveAsProject = (): void => {
  if (!canSaveAsProject()) return;
  const docName = useDocumentStore.getState().doc.name;
  useSaveAsProjectDialog.setState({
    open: true,
    name: docName && docName !== "Untitled" ? docName : "",
  });
};

/** Asks for the new project's name (the document's name is suggested). */
export const SaveAsProjectDialog = () => {
  const open = useSaveAsProjectDialog((s) => s.open);
  const setOpen = useSaveAsProjectDialog((s) => s.setOpen);
  const name = useSaveAsProjectDialog((s) => s.name);
  const setName = useSaveAsProjectDialog((s) => s.setName);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const done = await saveAsProject(name.trim());
    setBusy(false);
    if (done) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save as project</DialogTitle>
          <DialogDescription>
            Creates a project folder in the design folder with this document as its design, then
            opens it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="grid gap-1 text-xs">
            Project name
            <Input
              autoFocus
              value={name}
              placeholder="My app"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {busy ? <Spinner className="size-3" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
