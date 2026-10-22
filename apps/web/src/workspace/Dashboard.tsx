import { useEffect, useMemo, useState } from "react";
import {
  CopyIcon,
  FolderIcon,
  ImageOffIcon,
  PlusIcon,
  SearchIcon,
  TerminalIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import { Button } from "@pego/ui/components/button";
import { Input } from "@pego/ui/components/input";
import { useAgentStore } from "@/agent/use-agent-store";
import { useThemeStore } from "@/theme/theme";
import { getProjectPreview, type ProjectPreview } from "./project-preview";
import {
  createProjectFromDashboard,
  refreshProjects,
  useDashboardStore,
} from "./use-dashboard-store";
import { openProject } from "@/project/use-project-store";
import { activateWorkspace, SCRATCH_ID, useWorkspaceStore } from "./use-workspace-store";

const ago = (ms: number): string => {
  if (!ms) return "no files yet";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString();
};

/** The project's design, rendered by the canvas engine; a placeholder while it loads. */
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
                  ? "Empty design"
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
  <div
    role="button"
    tabIndex={0}
    className="group flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    onClick={() => void openProject(project)}
    onKeyDown={(event) => {
      if (event.key === "Enter") void openProject(project);
    }}
  >
    <ProjectThumbnail project={project} />
    <div className="flex items-start justify-between gap-2 px-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-foreground [&_svg]:size-3.5">
          <FolderIcon />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{project.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{project.relativeDir}</div>
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
);

/** Home page: every project in the design folder, a way to create one, and how to use them from Claude Code. */
export const Dashboard = () => {
  const { status, projects, error } = useDashboardStore();
  const connected = useAgentStore((s) => s.bridge.connected);
  const projectDir = useAgentStore((s) => s.bridge.projectDir ?? null);
  const rejected = useAgentStore((s) => s.bridge.rejectedReason);
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
            <h1 className="text-xl font-semibold text-foreground">Projects</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {projectDir ? `Design projects in ${projectDir}` : "Your design projects"}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <Button size="sm" variant="secondary" onClick={() => activateWorkspace(SCRATCH_ID)}>
              Scratch
            </Button>
            <Button size="sm" disabled={status !== "ready"} onClick={() => setCreating(true)}>
              <PlusIcon />
              New project
            </Button>
          </div>
        </div>

        {creating ? (
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

        {status === "offline" && rejected ? (
          <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
            The bridge on port 4519 is another Pego version and refused this editor: {rejected} Stop
            it and start this app's bridge (bun run bridge in this repository, or the desktop app).
          </div>
        ) : status === "offline" ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            Projects need the local Pego bridge. The desktop app starts it; in the browser run{" "}
            <code className="text-foreground">bun run bridge</code>. Scratch documents work without
            it.
          </div>
        ) : status === "none" ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            The bridge has no design folder. The desktop app uses ~/Documents/Pego; a bridge started
            in a repository uses its design/ folder (or set PEGO_DESIGN_DIR).
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

        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <TerminalIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">Work on a project from Claude Code</span>
            <span>
              Say the project name or id, for example "open project Checkout and design the payment
              screen" or "open project k3m9x0qa". Claude Code uses open_project, then edits that
              project's design here.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
