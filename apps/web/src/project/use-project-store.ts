import { toast } from "sonner";
import { create } from "zustand";
import type { ProjectFile, ProjectInfo } from "@pego/agent";
import { starterDocument } from "@pego/doc";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { openDocumentText } from "@/persistence/bridge-documents";
import { saveFile } from "@/persistence/file-actions";
import { FILE_EXTENSION, createEmptyDocument } from "@/persistence/file-format";
import {
  findTabByPath,
  openTab,
  PROJECT_DESIGN_FILE,
  switchTab,
  type UnsavedPolicy,
} from "@/tabs/use-tabs-store";
import { liveProject, openProjectWorkspace } from "@/workspace/use-workspace-store";

/** The design folder of the project, as listed by the local bridge. */
type ProjectState = {
  status: "offline" | "loading" | "ready" | "none" | "error";
  root: string | null;
  files: ProjectFile[];
  error: string | null;
};

export const useProjectStore = create<ProjectState>(() => ({
  status: "offline",
  root: null,
  files: [],
  error: null,
}));

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const refreshProject = async (): Promise<void> => {
  const { connected, projectDir } = useAgentStore.getState().bridge;
  if (!connected) {
    useProjectStore.setState({ status: "offline", files: [], error: null });
    return;
  }
  if (!projectDir) {
    useProjectStore.setState({ status: "none", root: null, files: [], error: null });
    return;
  }
  useProjectStore.setState({ status: "loading" });
  try {
    // The open project's folder, or the whole design folder for scratch documents.
    const response = await requestProject("list", liveProject()?.dir ?? undefined);
    useProjectStore.setState({
      status: "ready",
      root: response.root ?? projectDir,
      files: response.files ?? [],
      error: null,
    });
  } catch (error) {
    useProjectStore.setState({ status: "error", error: errorMessage(error) });
  }
};

/** Show a design file: its tab when already open, else read it through the bridge. */
export const openProjectFile = async (file: ProjectFile): Promise<void> => {
  const open = findTabByPath(file.path.replace(/\.pen$/i, FILE_EXTENSION));
  if (open) {
    switchTab(open.id);
    return;
  }
  try {
    const response = await requestProject("read", file.path);
    const outcome = openDocumentText(response.text ?? "", file.path);
    if (outcome.isError) toast.error(outcome.content);
  } catch (error) {
    toast.error(`Could not open ${file.relativePath}: ${errorMessage(error)}`);
  }
};

/** A file name for a new design: letters, digits, dashes; ".pego" added. Null when unusable. */
export const designFileName = (input: string): string | null => {
  const base = input
    .trim()
    .replace(/\.pego$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  if (!base || base.split("/").some((part) => part === "" || part === "..")) return null;
  return `${base}${FILE_EXTENSION}`;
};

/** Create design/<name>.pego with an empty document, open it in a tab and save it to disk. */
export const createProjectFile = async (input: string): Promise<void> => {
  const { files } = useProjectStore.getState();
  const root = liveProject()?.dir ?? useProjectStore.getState().root;
  const name = designFileName(input);
  if (!root || !name) {
    toast.error("Use a name made of letters, digits and dashes.");
    return;
  }
  const path = `${root}/${name}`;
  if (files.some((file) => file.path === path)) {
    toast.error(`${name} already exists.`);
    return;
  }
  const result = openTab(
    createEmptyDocument(),
    { fileName: name.split("/").pop()!, bridgePath: path },
    { saved: false },
  );
  if (result !== "opened") return;
  await saveFile();
  await refreshProject();
};

/**
 * Open a project: show its workspace and its design (project.pego) in a tab, creating the file
 * when the project has none yet. Resolves false when the workspace could not be shown.
 */
export const openProject = async (
  project: Pick<ProjectInfo, "id" | "name" | "dir"> & { mainFile?: string },
  unsaved: UnsavedPolicy = "ask",
): Promise<boolean> => {
  if (!openProjectWorkspace(project)) return false;
  const mainFile = project.mainFile ?? `${project.dir}/${PROJECT_DESIGN_FILE}`;
  const open = findTabByPath(mainFile);
  if (open) {
    switchTab(open.id);
    return true;
  }
  try {
    const response = await requestProject("read", mainFile);
    const outcome = openDocumentText(response.text ?? "", mainFile, { reload: false, unsaved });
    if (outcome.isError) toast.error(outcome.content);
    return true;
  } catch {
    // No project.pego yet (projects made before it existed): start one and save it.
    if (!useAgentStore.getState().bridge.connected) return true;
    const result = openTab(
      starterDocument(project.name),
      { fileName: PROJECT_DESIGN_FILE, bridgePath: mainFile },
      { saved: false, unsaved },
    );
    if (result !== "opened") return true;
    await saveFile();
    await refreshProject();
    return true;
  }
};
