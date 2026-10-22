import { toast } from "sonner";
import { create } from "zustand";
import type { ProjectFile } from "@pego/agent";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { openDocumentText } from "@/persistence/bridge-documents";
import { saveFile } from "@/persistence/file-actions";
import { FILE_EXTENSION, createEmptyDocument } from "@/persistence/file-format";
import { findTabByPath, openTab, switchTab } from "@/tabs/use-tabs-store";

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
    const response = await requestProject("list");
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
  const { root, files } = useProjectStore.getState();
  const name = designFileName(input);
  if (!root || !name) {
    toast.error("Use a name made of letters, digits and dashes.");
    return;
  }
  const path = `${root}/${name}`;
  if (files.some((file) => file.path === path)) {
    toast.error(`design/${name} already exists.`);
    return;
  }
  if (
    !openTab(
      createEmptyDocument(),
      { fileName: name.split("/").pop()!, bridgePath: path },
      { saved: false },
    )
  ) {
    return;
  }
  await saveFile();
  await refreshProject();
};
