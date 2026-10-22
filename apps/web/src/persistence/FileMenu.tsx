import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { newDocument, openFile, saveFile, saveFileAs } from "./file-actions";
import { DEFAULT_FILE_NAME } from "./file-format";
import { useFileStore } from "./use-file-store";
import { AutosaveStatus } from "./AutosaveStatus";
import { toggleAutoSave } from "./autosave-actions";
import { isFileAutosaveSupported } from "./file-autosave";
import { useAutosaveStore } from "./use-autosave-store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

const ITEMS = [
  { label: "New", shortcut: null, run: newDocument },
  { label: "Open…", shortcut: `${MOD}O`, run: openFile },
  { label: "Save", shortcut: `${MOD}S`, run: saveFile },
  { label: "Save as…", shortcut: `${SHIFT}${MOD}S`, run: saveFileAs },
] as const;

export const FileMenu = () => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileName = useFileStore((s) => s.fileName) ?? DEFAULT_FILE_NAME;
  const autosaveEnabled = useAutosaveStore((s) => s.enabled);
  const supported = isFileAutosaveSupported();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        File
        <ChevronDownIcon />
      </Button>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" title={fileName}>
        <span className="max-w-56 truncate">{fileName}</span>
      </span>
      <AutosaveStatus />
      {open ? (
        <div
          role="menu"
          className="absolute top-full left-0 z-50 mt-1 w-52 rounded-md border border-border bg-card p-1 shadow-md"
        >
          {ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => {
                setOpen(false);
                void item.run();
              }}
            >
              {item.label}
              {item.shortcut ? (
                <span className="text-xs text-muted-foreground">{item.shortcut}</span>
              ) : null}
            </button>
          ))}
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          <div
            title={
              supported
                ? undefined
                : "Saving to a file needs a Chromium browser. Changes are still kept in this browser."
            }
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={supported && autosaveEnabled}
              disabled={!supported}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
              onClick={() => {
                setOpen(false);
                toggleAutoSave();
              }}
            >
              {supported ? "Auto save" : "Auto save (browser only)"}
              {supported && autosaveEnabled ? <CheckIcon className="size-3.5" /> : null}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
