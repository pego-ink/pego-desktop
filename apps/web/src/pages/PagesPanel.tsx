import { useState } from "react";
import { CheckIcon, FileIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { PanelHeader } from "@pego/ui/components/panel-header";
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
      <PanelHeader>
        Pages
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Add page"
          title="Add page"
          onClick={() => addPage()}
        >
          <PlusIcon />
        </Button>
      </PanelHeader>
      <ul role="listbox" aria-label="Pages" className="min-h-0 overflow-y-auto py-1">
        {pages.map((page) => {
          const active = page.id === activeId;
          return (
            <li
              key={page.id}
              role="option"
              aria-selected={active}
              className={cn(
                "group mx-1.5 flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-xs text-muted-foreground hover:bg-accent/60",
                active && "bg-accent text-foreground",
              )}
              onClick={() => showPage(page.id)}
              onDoubleClick={() => setEditing(page.id)}
            >
              {active ? (
                <CheckIcon className="size-3.5 shrink-0" />
              ) : (
                <FileIcon className="size-3.5 shrink-0" />
              )}
              {editing === page.id ? (
                <input
                  autoFocus
                  aria-label="Page name"
                  defaultValue={page.name}
                  className="h-5 min-w-0 flex-1 rounded-sm bg-background px-1 text-xs text-foreground outline-none ring-1 ring-ring"
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
              {pages.length > 1 && editing !== page.id ? (
                <button
                  type="button"
                  aria-label={`Delete ${page.name}`}
                  title="Delete page"
                  className="hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground group-hover:flex [&_svg]:size-3"
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
