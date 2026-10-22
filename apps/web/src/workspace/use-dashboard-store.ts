import { toast } from "sonner";
import { create } from "zustand";
import type { ProjectInfo } from "@pego/agent";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { openProjectWorkspace } from "./use-workspace-store";

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
    if (response.project) openProjectWorkspace(response.project);
    await refreshProjects();
  } catch (error) {
    toast.error(`Could not create the project: ${errorMessage(error)}`);
  }
};
