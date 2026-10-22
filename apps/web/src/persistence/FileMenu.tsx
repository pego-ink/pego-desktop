import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { newDocument, openFile, saveFile, saveFileAs } from "./file-actions";
import { DEFAULT_FILE_NAME } from "./file-format";
import { useDocumentStore } from "@/store/use-document-store";
import { isProjectDesign } from "@/workspace/live-document";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A bridge project's design shows the project name (its document name), like its tab.
  const docName = useDocumentStore((s) => s.doc.name);
  const fileName = useFileStore((s) =>
    isProjectDesign(s.bridgePath) ? docName : (s.fileName ?? DEFAULT_FILE_NAME),
  );
  const autosaveEnabled = useAutosaveStore((s) => s.enabled);
  const supported = isFileAutosaveSupported();

  useEffect(() => {
    if (open)
      menuRef.current?.querySelector<HTMLElement>("[role^='menuitem']:not(:disabled)")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const focusItem = (index: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>(
      "[role^='menuitem']:not(:disabled)",
    );
    if (!items?.length) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") focusItem(current + 1);
    else if (event.key === "ArrowUp") focusItem(current - 1);
    else if (event.key === "Home") focusItem(0);
    else if (event.key === "End") focusItem(-1);
    else if (event.key === "Escape") closeMenu(true);
    else if (event.key === "Tab") setOpen(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      className="relative flex h-11 shrink-0 flex-col justify-center border-b border-border px-2"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`File menu, ${fileName}`}
        title={fileName}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
        className="-mx-1 flex h-5 min-w-0 items-center gap-1 self-start rounded-sm px-1 text-[13px] font-medium text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-accent"
      >
        <span className="max-w-full truncate">{fileName}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <div className="flex h-4 items-center">
        <AutosaveStatus />
      </div>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="File"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-2 left-2 z-50 mt-1 origin-top-left animate-[pego-pop-in_var(--duration-fast)_var(--ease-out)] rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
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
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
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
