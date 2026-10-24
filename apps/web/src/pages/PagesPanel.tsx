import { useState } from "react";
import { CheckIcon, FileIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { cn } from "@pego/ui/lib/utils";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { addPage, deletePage, renamePage, showPage } from "./page-actions";

/** Page list above the layers: click to show, double-click to rename, + to add. */
export const PagesPanel = () => {
  const pages = useDocumentStore((s) => s.doc.children);
  const activeId = useDocumentStore((s) => activePage(s).id);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex max-h-56 shrink-0 flex-col border-b border-border">
      <div className="flex h-9 shrink-0 items-center justify-between pr-2 pl-4">
        <span className="font-mono text-[10px] tracking-wider text-subtle-foreground uppercase">
          Pages
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Add page"
          title="Add page"
          onClick={() => addPage()}
        >
          <PlusIcon />
        </Button>
      </div>
      <ul role="listbox" aria-label="Pages" className="min-h-0 overflow-y-auto px-2 pb-2">
        {pages.map((page) => {
          const active = page.id === activeId;
          return (
            <li
              key={page.id}
              role="option"
              aria-selected={active}
              className={cn(
                "group flex h-8 cursor-default items-center gap-2 rounded-lg px-2 text-[13px] text-foreground hover:bg-accent",
                active && "bg-violet-soft text-violet-text hover:bg-violet-soft",
              )}
              onClick={() => showPage(page.id)}
              onDoubleClick={() => setEditing(page.id)}
            >
              <FileIcon
                className={cn(
                  "size-3.5 shrink-0",
                  active ? "text-violet-text" : "text-subtle-foreground",
                )}
              />
              {editing === page.id ? (
                <input
                  autoFocus
                  aria-label="Page name"
                  defaultValue={page.name}
                  className="h-5 min-w-0 flex-1 rounded-md bg-background px-1 text-[13px] text-foreground outline-none ring-1 ring-ring"
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    renamePage(page.id, event.currentTarget.value);
                    setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setEditing(null);
                    event.stopPropagation();
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{page.name}</span>
              )}
              {active && editing !== page.id ? (
                <CheckIcon
                  aria-hidden
                  className={cn("size-3.5 shrink-0", pages.length > 1 && "group-hover:hidden")}
                />
              ) : null}
              {pages.length > 1 && editing !== page.id ? (
                <button
                  type="button"
                  aria-label={`Delete ${page.name}`}
                  title="Delete page"
                  className="hidden size-5 shrink-0 items-center justify-center rounded-sm text-subtle-foreground hover:text-foreground group-hover:flex [&_svg]:size-3"
                  onClick={(event) => {
                    event.stopPropagation();
                    deletePage(page.id);
                  }}
                >
                  <Trash2Icon />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
