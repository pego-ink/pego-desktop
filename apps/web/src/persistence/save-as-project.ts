import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import type { PegoDocument } from "@pego/doc";
import { requestProject, saveFileViaBridge } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { openProject } from "@/project/use-project-store";
import { useDocumentStore } from "@/store/use-document-store";
import { refreshProjects } from "@/workspace/use-dashboard-store";
import {
  forceCloseWorkspace,
  liveWorkspace,
  workspaceRunning,
} from "@/workspace/use-workspace-store";
import { sourceOf } from "./document-source";
import { serializeDocument } from "./file-format";
import { useFileStore } from "./use-file-store";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The bridge calls Save as project makes (replaced in tests). */
export type SaveAsProjectBridge = {
  createProject: (name: string) => Promise<ProjectInfo>;
  writeFile: (path: string, text: string) => Promise<void>;
  openProject: (project: ProjectInfo) => Promise<boolean>;
};

const bridge: SaveAsProjectBridge = {
  createProject: async (name) => {
    const { project } = await requestProject("create_project", undefined, name);
    if (!project) throw new Error("the bridge did not return the project");
    return project;
  },
  writeFile: saveFileViaBridge,
  openProject: (project) => openProject(project),
};

/** The shown document as a project's design: same content, the project's name and id. */
export const asProjectDocument = (doc: PegoDocument, project: ProjectInfo): PegoDocument => ({
  ...doc,
  id: project.id,
  name: project.name,
});

/** Save as project needs a bridge with a design folder; says why not otherwise. */
export const canSaveAsProject = (): boolean => {
  const { connected, projectDir } = useAgentStore.getState().bridge;
  if (!connected) {
    toast.error("Saving as a project needs the Pego bridge (bun run dev, or the desktop app).");
    return false;
  }
  if (!projectDir) {
    toast.error("The Pego bridge has no design folder, so it cannot create projects.");
    return false;
  }
  return true;
};

/**
 * File › Save as project…: create a project folder through the bridge, write the shown document
 * as its project.pego and open the project's tab. An untitled document that was never saved
 * moves into the project (its tab closes); one with a file keeps its tab, so this also copies a
 * document or a project into a new project.
 */
export const saveAsProject = async (
  name: string,
  calls: SaveAsProjectBridge = bridge,
): Promise<boolean> => {
  const origin = liveWorkspace();
  const moves = origin?.kind === "local" && sourceOf(useFileStore.getState()).kind === "none";
  try {
    const project = await calls.createProject(name);
    const doc = asProjectDocument(useDocumentStore.getState().doc, project);
    await calls.writeFile(project.mainFile, serializeDocument(doc));
    if (!(await calls.openProject(project))) throw new Error("its tab could not be shown");
    if (moves && origin && !workspaceRunning(origin.id)) forceCloseWorkspace(origin.id);
    void refreshProjects();
    toast.success(`Saved as project ${project.name}`, { description: project.dir });
    return true;
  } catch (error) {
    toast.error(`Could not save as a project: ${errorMessage(error)}`);
    return false;
  }
};
