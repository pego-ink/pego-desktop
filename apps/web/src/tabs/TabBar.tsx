import { PlusIcon, XIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@pego/ui/lib/utils";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { closeTab, newTab, switchTab, tabIsDirty, tabTitle, useTabsStore } from "./use-tabs-store";

/** Open documents above the canvas: click to switch, middle-click or × to close, + for a new one. */
export const TabBar = () => {
  const { tabs, activeId } = useTabsStore(
    useShallow((s) => ({ tabs: s.tabs, activeId: s.activeId })),
  );
  // Re-render on edits and saves so the active tab's dirty dot and name stay current.
  useDocumentStore((s) => s.doc);
  useFileStore((s) => s.savedDoc);
  useFileStore((s) => s.fileName);

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const dirty = tabIsDirty(tab);
        const title = tabTitle(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={tab.snapshot?.file.bridgePath ?? useFileStore.getState().bridgePath ?? title}
            className={cn(
              "group flex max-w-52 min-w-28 cursor-default items-center gap-1.5 border-r border-border px-3 text-xs text-muted-foreground hover:text-foreground",
              active && "bg-background text-foreground",
            )}
            onClick={() => switchTab(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) closeTab(tab.id);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <button
              type="button"
              aria-label={`Close ${title}`}
              title="Close"
              className="relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent [&_svg]:size-3"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            >
              {dirty ? (
                <span
                  aria-label="Unsaved changes"
                  className="size-1.5 rounded-full bg-foreground group-hover:hidden"
                />
              ) : null}
              <XIcon className={cn(dirty && "hidden group-hover:block")} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New document"
        title="New document"
        className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
        onClick={() => newTab()}
      >
        <PlusIcon />
      </button>
    </div>
  );
};
