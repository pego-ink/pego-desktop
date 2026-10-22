import { FolderIcon, NotebookPenIcon, XIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { useTabsStore } from "@/tabs/use-tabs-store";
import {
  activateWorkspace,
  closeWorkspace,
  useWorkspaceStore,
  workspaceIsDirty,
} from "./use-workspace-store";

const tabClass = (active: boolean) =>
  cn(
    "group flex h-8 max-w-48 shrink-0 cursor-default items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
    active && "bg-accent text-foreground",
  );

/** Header tabs: scratch documents and every open project (the Pego logo opens the dashboard). */
export const WorkspaceTabs = () => {
  const { workspaces, liveId, view } = useWorkspaceStore();
  // Re-render when the live workspace's documents change (unsaved marker).
  useTabsStore((s) => s.tabs);

  return (
    <nav aria-label="Projects" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {workspaces.map((workspace) => {
        const active = view === "editor" && workspace.id === liveId;
        const dirty = workspaceIsDirty(workspace);
        return (
          <div
            key={workspace.id}
            role="tab"
            aria-selected={active}
            title={workspace.dir ?? "Documents outside any project"}
            className={tabClass(active)}
            onClick={() => activateWorkspace(workspace.id)}
          >
            {workspace.kind === "scratch" ? <NotebookPenIcon /> : <FolderIcon />}
            <span className="min-w-0 truncate">{workspace.name}</span>
            {dirty ? (
              <span
                aria-label="Unsaved documents"
                className="size-1.5 rounded-full bg-foreground"
              />
            ) : null}
            {workspace.kind === "project" ? (
              <button
                type="button"
                aria-label={`Close ${workspace.name}`}
                title="Close project"
                className="flex size-4 items-center justify-center rounded-sm opacity-0 hover:bg-accent group-hover:opacity-100 [&_svg]:size-3"
                onClick={(event) => {
                  event.stopPropagation();
                  closeWorkspace(workspace.id);
                }}
              >
                <XIcon />
              </button>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
};
