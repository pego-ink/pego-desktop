import { useEffect, useState } from "react";
import { FilePlusIcon, FileIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { useFileStore } from "@/persistence/use-file-store";
import {
  createProjectFile,
  openProjectFile,
  refreshProject,
  useProjectStore,
} from "./use-project-store";

/** Design files of the project (design/ in the repo, served by the local bridge). */
export const ProjectPanel = () => {
  const { status, files, error } = useProjectStore();
  const connected = useAgentStore((s) => s.bridge.connected);
  const projectDir = useAgentStore((s) => s.bridge.projectDir ?? null);
  const openPath = useFileStore((s) => s.bridgePath);
  const savedDoc = useFileStore((s) => s.savedDoc);
  const [creating, setCreating] = useState(false);

  // List again when the bridge (re)connects, and when the window regains focus.
  useEffect(() => void refreshProject(), [connected, projectDir]);
  // A save to a design file may have created it: list again.
  useEffect(() => {
    if (openPath && savedDoc) void refreshProject();
  }, [openPath, savedDoc]);
  useEffect(() => {
    const onFocus = () => void refreshProject();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <div className="flex max-h-64 shrink-0 flex-col border-b border-border">
      <PanelHeader>
        <span className="truncate" title={projectDir ?? undefined}>
          Project{" "}
          {status === "ready" ? <span className="text-muted-foreground">· design/</span> : null}
        </span>
        {status === "ready" || status === "loading" ? (
          <span className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New design file"
              title="New design file"
              onClick={() => setCreating(true)}
            >
              <FilePlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh"
              title="Refresh"
              onClick={() => void refreshProject()}
            >
              <RefreshCwIcon className={cn(status === "loading" && "animate-spin")} />
            </Button>
          </span>
        ) : null}
      </PanelHeader>
      <div className="min-h-0 overflow-y-auto py-1">
        {status === "offline" ? (
          <p className="px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
            Start the bridge (<code>bun run bridge</code>) to see the design files of this project.
          </p>
        ) : status === "none" ? (
          <p className="px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
            No design/ folder in this repository.
          </p>
        ) : status === "error" ? (
          <p className="px-3 py-1.5 text-[11px] leading-4 text-destructive">{error}</p>
        ) : null}
        {creating ? (
          <form
            className="mx-1.5 mb-1 flex h-7 items-center gap-2 rounded-sm px-2"
            onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget).get("name");
              setCreating(false);
              if (typeof input === "string" && input.trim()) void createProjectFile(input);
            }}
          >
            <FilePlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              name="name"
              autoFocus
              placeholder="new-screen"
              aria-label="New file name"
              className="h-5 min-w-0 flex-1 rounded-sm bg-background px-1 text-xs text-foreground outline-none ring-1 ring-ring"
              onBlur={() => setCreating(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
                event.stopPropagation();
              }}
            />
          </form>
        ) : null}
        <ul aria-label="Design files">
          {files.map((file) => {
            const active = file.path === openPath;
            return (
              <li key={file.path}>
                <button
                  type="button"
                  title={file.path}
                  className={cn(
                    "mx-1.5 flex h-7 w-[calc(100%-0.75rem)] items-center gap-2 rounded-sm px-2 text-left text-xs text-muted-foreground hover:bg-accent/60",
                    active && "bg-accent text-foreground",
                  )}
                  onClick={() => void openProjectFile(file)}
                >
                  <FileIcon className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {status === "ready" && files.length === 0 && !creating ? (
          <p className="px-3 py-1.5 text-[11px] leading-4 text-muted-foreground">
            No .pego files yet. Create one with the + button.
          </p>
        ) : null}
      </div>
    </div>
  );
};
