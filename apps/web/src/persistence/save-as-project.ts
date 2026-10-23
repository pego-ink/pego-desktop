import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import type { PegoDocument } from "@pego/doc";
import { requestProject, saveFileViaBridge } from "@/agent/bridge-client";
import { moveSessions } from "@/agent/sessions/session-db";
import { forgetSessionHomesIn } from "@/agent/sessions/session-home";
import { useAgentStore } from "@/agent/use-agent-store";
import { openProject } from "@/project/use-project-store";
import { useDocumentStore } from "@/store/use-document-store";
import { refreshProjects } from "@/workspace/use-dashboard-store";
import {
  forceCloseWorkspace,
  liveWorkspace,
  workspaceDocument,
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
  /** Move the new project's folder to the Trash (rollback). */
  trashProject: (projectId: string) => Promise<void>;
};

const bridge: SaveAsProjectBridge = {
  createProject: async (name) => {
    const { project } = await requestProject("create_project", undefined, name);
    if (!project) throw new Error("the bridge did not return the project");
    return project;
  },
  writeFile: saveFileViaBridge,
  openProject: (project) => openProject(project),
  trashProject: async (projectId) => {
    await requestProject("trash_project", undefined, undefined, projectId);
  },
};

/** The shown document as a project's design: same content, the project's name and id. */
export const asProjectDocument = (doc: PegoDocument, project: ProjectInfo): PegoDocument => ({
  ...doc,
  id: project.id,
  name: project.name,
});

const RUNNING_MESSAGE = "Stop the running agent first: its tab cannot be replaced while it works.";

/** Save as project needs a bridge with a design folder and no agent run in the shown tab. */
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
  return !runBlocked();
};

/** A panel agent run works in the shown tab: its tab cannot be replaced meanwhile. */
const runBlocked = (): boolean => {
  const live = liveWorkspace();
  if (!live || !workspaceRunning(live.id)) return false;
  toast.error(RUNNING_MESSAGE);
  return true;
};

/**
 * File › Save as project…: create a project folder through the bridge, write the shown document
 * as its project.pego and open the project's tab. An untitled document that was never saved
 * moves into the project (its tab closes, its chats follow); one with a file keeps its tab, so
 * this also copies a document or a project into a new project. Blocking conditions are checked
 * before anything is created; if a later step fails, the new folder goes to the Trash.
 *
 * If the original tab changed while the project was being made (an MCP edit), it stays open and
 * the user is told the project holds the earlier state: closing it would lose that edit.
 */
export const saveAsProject = async (
  name: string,
  calls: SaveAsProjectBridge = bridge,
): Promise<boolean> => {
  if (runBlocked()) return false;
  const origin = liveWorkspace();
  const moves = origin?.kind === "local" && sourceOf(useFileStore.getState()).kind === "none";
  const captured = useDocumentStore.getState().doc;
  let project: ProjectInfo | null = null;
  let sessionsMoved = false;
  try {
    project = await calls.createProject(name);
    await calls.writeFile(
      project.mainFile,
      serializeDocument(asProjectDocument(captured, project)),
    );
    if (moves) sessionsMoved = (await moveSessions(captured.id, project.id)).length > 0;
    if (!(await calls.openProject(project))) throw new Error("its tab could not be shown");
  } catch (error) {
    if (project) {
      if (sessionsMoved) await moveSessions(project.id, captured.id);
      await calls.trashProject(project.id).catch(() => undefined);
      void refreshProjects();
    }
    toast.error(`Could not save as a project: ${errorMessage(error)}`);
    return false;
  }
  let edited = false;
  if (moves && origin) {
    // The tab is a snapshot now (the project is shown): compare it with what was saved.
    edited = workspaceDocument(origin.id)?.doc !== captured;
    if (!edited) {
      forceCloseWorkspace(origin.id);
      forgetSessionHomesIn(origin.id);
    }
  }
  void refreshProjects();
  toast.success(`Saved as project ${project.name}`, {
    description: edited
      ? "The original tab changed meanwhile and stays open; the project has the earlier state."
      : project.dir,
  });
  return true;
};
