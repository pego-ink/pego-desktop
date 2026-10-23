import { toast } from "sonner";
import { create } from "zustand";
import type { ProjectInfo } from "@pego/agent";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { forgetSessionHomesIn } from "@/agent/sessions/session-home";
import { openProject } from "@/project/use-project-store";
import { forgetProjectPreviews } from "./project-preview";
import { tabToClose, trashedMessage, trashFailedMessage } from "./trash-project-model";
import { closeTabAndWait } from "./use-close-confirm";
import { useWorkspaceStore } from "./use-workspace-store";

/** Projects of the repository (design/<project>/project.json), as listed by the bridge. */
type DashboardState = {
  status: "offline" | "loading" | "ready" | "none" | "error";
  projects: ProjectInfo[];
  error: string | null;
};

export const useDashboardStore = create<DashboardState>(() => ({
  status: "offline",
  projects: [],
  error: null,
}));

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const refreshProjects = async (): Promise<void> => {
  const { connected, projectDir } = useAgentStore.getState().bridge;
  if (!connected) return void useDashboardStore.setState({ status: "offline", error: null });
  if (!projectDir)
    return void useDashboardStore.setState({ status: "none", projects: [], error: null });
  useDashboardStore.setState((state) => ({
    status: state.projects.length ? state.status : "loading",
  }));
  try {
    const response = await requestProject("projects");
    useDashboardStore.setState({ status: "ready", projects: response.projects ?? [], error: null });
  } catch (error) {
    useDashboardStore.setState({ status: "error", error: errorMessage(error) });
  }
};

/** Create design/<name>/project.json through the bridge and open the new project. */
export const createProjectFromDashboard = async (name: string): Promise<void> => {
  try {
    const response = await requestProject("create_project", undefined, name);
    if (response.project) await openProject(response.project);
    await refreshProjects();
  } catch (error) {
    toast.error(`Could not create the project: ${errorMessage(error)}`);
  }
};

type TrashConfirmState = { open: boolean; project: ProjectInfo | null };

/** The project waiting for the "Move to Trash?" answer. `project` stays while the dialog fades. */
export const useTrashConfirm = create<TrashConfirmState>(() => ({ open: false, project: null }));

export const askTrashProject = (project: ProjectInfo): void =>
  useTrashConfirm.setState({ open: true, project });

export const dismissTrashConfirm = (): void => useTrashConfirm.setState({ open: false });

/**
 * Move the project's folder to the OS Trash through the bridge. Its tab is closed first (asking
 * about unsaved changes; keeping the tab aborts), then previews and session homes are dropped.
 * Chat history stays.
 */
export const trashConfirmedProject = async (): Promise<void> => {
  const { project } = useTrashConfirm.getState();
  dismissTrashConfirm();
  if (!project) return;
  const tab = tabToClose(useWorkspaceStore.getState().workspaces, project.id);
  if (tab && !(await closeTabAndWait(tab))) return;
  try {
    await requestProject("trash_project", undefined, undefined, project.id);
  } catch (error) {
    toast.error(trashFailedMessage(project.name, errorMessage(error)));
    await refreshProjects();
    return;
  }
  forgetProjectPreviews(project.id);
  forgetSessionHomesIn(project.id);
  await refreshProjects();
  toast.success(trashedMessage(project.name));
};
