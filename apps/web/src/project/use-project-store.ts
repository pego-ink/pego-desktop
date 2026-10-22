import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import { starterDocument } from "@pego/doc";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { openDocumentText } from "@/persistence/bridge-documents";
import { saveFile } from "@/persistence/file-actions";
import {
  findTabByPath,
  openTab,
  PROJECT_DESIGN_FILE,
  switchTab,
  type UnsavedPolicy,
} from "@/tabs/use-tabs-store";
import { openProjectWorkspace } from "@/workspace/use-workspace-store";

/**
 * Open a project: show its workspace and its design (project.pego), creating the file
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
    return true;
  }
};
