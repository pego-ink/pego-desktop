import { useEffect, useMemo, useState } from "react";
import {
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  ImageOffIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@pego/ui/components/alert-dialog";
import { Button } from "@pego/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@pego/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { Input } from "@pego/ui/components/input";
import { useAgentStore } from "@/agent/use-agent-store";
import { useThemeStore } from "@/theme/theme";
import { getProjectPreview, type ProjectPreview } from "./project-preview";
import { trashConfirmText } from "./trash-project-model";
import { exportProject, PROJECT_EXPORTS } from "./project-export";
import {
  askTrashProject,
  createProjectFromDashboard,
  dismissTrashConfirm,
  refreshProjects,
  trashConfirmedProject,
  useDashboardStore,
  useTrashConfirm,
} from "./use-dashboard-store";
import { openProject } from "@/project/use-project-store";
import { openFile } from "@/persistence/file-actions";
import { newDocumentTab, useWorkspaceStore } from "./use-workspace-store";

const ago = (ms: number): string => {
  if (!ms) return "no files yet";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString();
};

/** The project's latest design, rendered by the canvas engine; a placeholder while it loads. */
const ProjectThumbnail = ({ project }: { project: ProjectInfo }) => {
  const theme = useThemeStore((s) => s.resolved);
  const key = `${project.id}:${project.modifiedAt}:${theme}`;
  const [loaded, setLoaded] = useState<{ key: string; preview: ProjectPreview | "error" } | null>(
    null,
  );
  // A result for another key (older change, other theme) means the new one is still loading.
  const preview = loaded?.key === key ? loaded.preview : "loading";

  useEffect(() => {
    let cancelled = false;
    getProjectPreview(project, theme).then(
      (result) => !cancelled && setLoaded({ key, preview: result }),
      () => !cancelled && setLoaded({ key, preview: "error" }),
    );
    return () => {
      cancelled = true;
    };
  }, [project, theme, key]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-muted">
      {preview !== "loading" && preview !== "error" && preview.image ? (
        <img
          src={preview.image}
          alt={`Preview of ${preview.file ?? project.name}`}
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 text-[11px] text-muted-foreground [&_svg]:size-5">
          {preview === "loading" ? (
            <span className="h-full w-full animate-pulse bg-accent/50" />
          ) : (
            <>
              <ImageOffIcon />
              {preview === "error"
                ? "Preview unavailable"
                : project.fileCount
                  ? "Empty page"
                  : "No designs yet"}
            </>
          )}
        </div>
      )}
      {preview !== "loading" && preview !== "error" && preview.file ? (
        <span className="absolute right-1.5 bottom-1.5 max-w-[70%] truncate rounded-sm bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
          {preview.file}
        </span>
      ) : null}
    </div>
  );
};

const ProjectCard = ({ project, open }: { project: ProjectInfo; open: boolean }) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      <div
        role="button"
        tabIndex={0}
        className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => void openProject(project)}
        onKeyDown={(event) => {
          // Enter on the inner menu buttons must not open the project.
          if (event.key === "Enter" && event.target === event.currentTarget)
            void openProject(project);
        }}
      >
        <ProjectThumbnail project={project} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon-xs"
              aria-label={`More actions for ${project.name}`}
              className="absolute top-5 right-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="min-w-52"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">Export</div>
            {PROJECT_EXPORTS.map(({ kind, label }) => (
              <DropdownMenuItem key={kind} onSelect={() => void exportProject(project, kind)}>
                <DownloadIcon className="size-3.5" />
                {label}
              </DropdownMenuItem>
            ))}
            <div role="separator" className="-mx-1 my-1 h-px bg-border" />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => askTrashProject(project)}
            >
              <Trash2Icon className="size-3.5" />
              Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-start justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-foreground [&_svg]:size-3.5">
              <FolderIcon />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{project.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                design/{project.relativeDir}
              </div>
            </div>
          </div>
          {open ? (
            <span className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-foreground">
              Open
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>
            {project.fileCount} file{project.fileCount === 1 ? "" : "s"} · {ago(project.modifiedAt)}
          </span>
          <button
            type="button"
            title="Copy project id"
            className="flex items-center gap-1 rounded-sm px-1 font-mono hover:bg-accent hover:text-foreground [&_svg]:size-3"
            onClick={(event) => {
              event.stopPropagation();
              void navigator.clipboard
                ?.writeText(project.id)
                .then(() => toast.success("Project id copied"));
            }}
          >
            {project.id}
            <CopyIcon />
          </button>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="min-w-44" onClick={(event) => event.stopPropagation()}>
      <ContextMenuItem onSelect={() => void openProject(project)}>Open</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Export</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {PROJECT_EXPORTS.map(({ kind, label }) => (
            <ContextMenuItem key={kind} onSelect={() => void exportProject(project, kind)}>
              {label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem destructive onSelect={() => askTrashProject(project)}>
        Move to Trash
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);

/** "Move “name” to the Trash?" for the project picked in a card menu. */
const TrashProjectDialog = () => {
  const { open, project } = useTrashConfirm();
  const text = project ? trashConfirmText(project) : null;
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : dismissTrashConfirm())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <code data-selectable className="block truncate font-mono text-foreground">
              {text?.folder}
            </code>
            <span className="mt-1 block">{text?.hint}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{text?.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void trashConfirmedProject()}>
            {text?.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/** Home page: every project of the repository, a way to create one, and how to use them from Claude Code. */
export const Dashboard = () => {
  const { status, projects, error } = useDashboardStore();
  const connected = useAgentStore((s) => s.bridge.connected);
  const projectDir = useAgentStore((s) => s.bridge.projectDir ?? null);
  // Projects exist only while a bridge serves a design folder; without one Home is just
  // "new document" and "open file".
  const hasBridge = connected && projectDir !== null;
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const openIds = useMemo(() => new Set(workspaces.map((workspace) => workspace.id)), [workspaces]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => void refreshProjects(), [connected, projectDir]);
  useEffect(() => {
    const onFocus = () => void refreshProjects();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.id.startsWith(q))
      : projects;
  }, [projects, query]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {hasBridge ? "Projects" : "Home"}
            </h1>
            {hasBridge ? (
              <p data-selectable className="mt-1 text-xs text-muted-foreground">
                Design projects in {projectDir}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {hasBridge ? (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search projects"
                  placeholder="Search by name or id"
                  className="h-8 w-56 pl-7 text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => void openFile()}>
              Open file…
            </Button>
            <Button
              size="sm"
              variant={hasBridge ? "secondary" : "default"}
              onClick={() => newDocumentTab()}
            >
              New document
            </Button>
            {hasBridge ? (
              <Button size="sm" disabled={status !== "ready"} onClick={() => setCreating(true)}>
                <PlusIcon />
                New project
              </Button>
            ) : null}
          </div>
        </div>

        {hasBridge && creating ? (
          <form
            className="flex items-center gap-2 rounded-lg border border-border bg-card p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              setCreating(false);
              setName("");
              void createProjectFromDashboard(trimmed);
            }}
          >
            <Input
              autoFocus
              aria-label="Project name"
              placeholder="Project name, e.g. Checkout redesign"
              className="h-8 flex-1 text-xs"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <Button size="sm" type="submit" disabled={!name.trim()}>
              Create
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </form>
        ) : null}

        {!hasBridge ? null : status === "offline" ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            Start the bridge with{" "}
            <code data-selectable className="text-foreground">
              bun run bridge
            </code>{" "}
            to see the projects in this repository's design/ folder. Local documents work without
            it.
          </div>
        ) : status === "none" ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            This repository has no design/ folder. Create one (or set PEGO_DESIGN_DIR for the
            bridge) to keep projects there.
          </div>
        ) : status === "error" ? (
          <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : shown.length === 0 && status === "ready" ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            {projects.length === 0
              ? "No projects yet. Create the first one."
              : "No project matches the search."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((project) => (
              <ProjectCard key={project.id} project={project} open={openIds.has(project.id)} />
            ))}
          </div>
        )}

        {hasBridge ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
            <TerminalIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">
                Work on a project from Claude Code
              </span>
              <span>
                Say the project name or id, for example "open project Checkout and design the
                payment screen" or "open project k3m9x0qa". Claude Code uses open_project, then
                edits that project's files here.
              </span>
            </div>
          </div>
        ) : null}
      </div>
      <TrashProjectDialog />
    </div>
  );
};
