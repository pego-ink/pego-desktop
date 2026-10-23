import { toast } from "sonner";
import type { ProjectInfo } from "@pego/agent";
import { starterDocument } from "@pego/doc";
import { requestProject } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { openDocumentText } from "@/persistence/bridge-documents";
import { saveFile } from "@/persistence/file-actions";
import { useFileStore } from "@/persistence/use-file-store";
import { PROJECT_DESIGN_FILE, type UnsavedPolicy } from "@/workspace/live-document";
import { openDocument, openProjectWorkspace } from "@/workspace/use-workspace-store";

/**
 * Open a project: show its tab and its design (project.pego), creating the file when the project
 * has none yet. Resolves false when the tab could not be shown.
 * The design's document id is the project id, so chat sessions (keyed by document id) follow
 * the project; an older file with another id adopts it (an unsaved change that autosave writes).
 */
export const openProject = async (
  project: Pick<ProjectInfo, "id" | "name" | "dir"> & { mainFile?: string; hasMainFile?: boolean },
  unsaved: UnsavedPolicy = "ask",
): Promise<boolean> => {
  if (!openProjectWorkspace(project)) return false;
  const mainFile = project.mainFile ?? `${project.dir}/${PROJECT_DESIGN_FILE}`;
  // The workspace already shows its design.
  if (useFileStore.getState().bridgePath === mainFile) return true;
  try {
    const response = await requestProject("read", mainFile);
    const outcome = openDocumentText(response.text ?? "", mainFile, {
      reload: false,
      unsaved,
      documentId: project.id,
      place: "replace",
    });
    if (outcome.isError) toast.error(outcome.content);
    return true;
  } catch (error) {
    // Only a project known to have no project.pego yet (made before it existed) starts a new
    // design; any other read failure (timeout, too big, permissions) must never overwrite it.
    if (project.hasMainFile !== false) {
      toast.error(
        `Could not open ${project.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    if (!useAgentStore.getState().bridge.connected) return true;
    const result = openDocument(
      starterDocument(project.name, project.id),
      { fileName: PROJECT_DESIGN_FILE, bridgePath: mainFile },
      { saved: false, unsaved, place: "replace" },
    );
    if (result !== "opened") return true;
    await saveFile();
    return true;
  }
};
