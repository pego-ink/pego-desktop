import { useEffect, useState } from "react";
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
import { forgetFigmaToken, importFromFigma, loadFigmaToken } from "./figma-import";

export const useFigmaImportDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);

/** File › Import from Figma…: a link to a frame (or a file) and a personal access token. */
export const FigmaImportDialog = () => {
  const open = useFigmaImportDialog((s) => s.open);
  const setOpen = useFigmaImportDialog((s) => s.setOpen);
  const [link, setLink] = useState("");
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  // A remembered token fills the field when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadFigmaToken().then((saved) => {
      if (live && saved) setToken((current) => current || saved);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const submit = async () => {
    setBusy(true);
    const done = await importFromFigma(link, token, remember);
    setBusy(false);
    if (done) {
      setLink("");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import from Figma</DialogTitle>
          <DialogDescription>
            Paste a link to a frame (Copy link to selection in Figma) or to a file for its first
            page. Auto layout, text, fills, strokes, effects, vectors and images come in as editable
            layers.
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
            Figma link
            <Input
              autoFocus
              value={link}
              placeholder="https://www.figma.com/design/…?node-id=…"
              onChange={(event) => setLink(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs">
            Personal access token
            <Input
              type="password"
              autoComplete="off"
              value={token}
              placeholder="figd_…"
              onChange={(event) => setToken(event.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              Figma › Settings › Security › Personal access tokens, with read access to file
              content. Used only for requests to api.figma.com.
            </span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => {
                setRemember(event.target.checked);
                if (!event.target.checked) void forgetFigmaToken();
              }}
            />
            Remember the token on this device
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !link.trim() || !token.trim()}>
              {busy ? <Spinner className="size-3" /> : null}
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
