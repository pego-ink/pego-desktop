import { useState } from "react";
import { LibraryIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@pego/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { formatRelativeTime } from "@/panels/agent/session-format";
import { parseDocumentFile } from "@/persistence/file-format";
import { useDocumentStore } from "@/store/use-document-store";
import { useDashboardStore, refreshProjects } from "@/workspace/use-dashboard-store";
import { libraryPages, removeLibraryOps, syncLibraryOps, type LibrarySource } from "./libraries";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Copy a library's components in (or again), as one undo step. */
const syncLibrary = async (library: LibrarySource, update: boolean) => {
  try {
    const response = await requestProject("read", library.path);
    const source = parseDocumentFile(response.text ?? "");
    const state = useDocumentStore.getState();
    const plan = syncLibraryOps(state.doc, source, library, Date.now());
    if (plan.count === 0) return void toast(`${library.name} has no components to share yet.`);
    if (state.commit(plan.ops, { label: update ? "Update library" : "Add library" })) {
      if (plan.conflicts.length > 0) {
        toast.warning(
          `Kept your variables ${plan.conflicts.join(", ")}: ${library.name} defines them differently.`,
        );
      }
      if (plan.warnings.length > 0) toast.warning(plan.warnings.join("; "));
      toast.success(
        `${update ? "Updated" : "Added"} ${library.name}: ${plan.count} component${plan.count === 1 ? "" : "s"}`,
      );
    }
  } catch (error) {
    toast.error(`Could not read ${library.name}: ${messageOf(error)}`);
  }
};

const removeLibrary = (pageId: string, name: string) => {
  const state = useDocumentStore.getState();
  if (state.commit(removeLibraryOps(state.doc, pageId), { label: "Remove library" })) {
    toast(`Removed ${name}; layers made from it stay as plain layers.`);
  }
};

/**
 * Libraries: other projects whose components this document uses. Adding one copies its components
 * onto a library page; Update copies them again (instances keep working); Remove keeps what was
 * made from it as plain layers.
 */
export const LibrariesSection = () => {
  const doc = useDocumentStore((s) => s.doc);
  const connected = useAgentStore((s) => s.bridge.connected);
  const projects = useDashboardStore((s) => s.projects);
  const [busy, setBusy] = useState<string | null>(null);
  const pages = libraryPages(doc);
  const linked = new Set(pages.map((page) => page.library!.projectId));
  const choices = projects.filter((project) => project.id !== doc.id && !linked.has(project.id));

  const run = async (key: string, task: () => Promise<void> | void) => {
    setBusy(key);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Libraries" className="border-t border-border px-3 py-2">
      <div className="flex h-7 items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Libraries</h3>
        <DropdownMenu onOpenChange={(open) => open && void refreshProjects()}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add a library"
              title={connected ? "Use another project's components" : "Needs the local bridge"}
              disabled={!connected || busy !== null}
            >
              <PlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {choices.length === 0 ? (
              <DropdownMenuItem disabled>No other projects</DropdownMenuItem>
            ) : (
              choices.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onSelect={() =>
                    void run(project.id, () =>
                      syncLibrary(
                        { projectId: project.id, name: project.name, path: project.mainFile },
                        false,
                      ),
                    )
                  }
                >
                  <LibraryIcon aria-hidden className="size-3.5" />
                  {project.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {pages.length === 0 ? (
        <p className="pb-1 text-[11px] leading-4 text-muted-foreground">
          Use the components of another project: add it as a library.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 pb-1">
          {pages.map((page) => {
            const library = page.library!;
            return (
              <li key={page.id} className="flex h-8 items-center gap-2 text-xs">
                <LibraryIcon aria-hidden className="size-3.5 shrink-0 text-violet" />
                <span className="min-w-0 flex-1 truncate">{library.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatRelativeTime(library.syncedAt)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Update ${library.name}`}
                  title="Copy its components again"
                  disabled={!connected || busy !== null}
                  onClick={() => void run(page.id, () => syncLibrary(library, true))}
                >
                  <RefreshCwIcon className={busy === page.id ? "animate-spin" : undefined} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${library.name}`}
                  title="Remove (layers made from it stay as plain layers)"
                  disabled={busy !== null}
                  onClick={() => removeLibrary(page.id, library.name)}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
