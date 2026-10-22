import { toast } from "sonner";
import { saveFile, saveFileAs, writeDocToHandle } from "./file-actions";
import { resumeFileAutosave } from "./file-autosave";
import { ensureWritePermission, requestWritePermission } from "./file-permission";
import { useAutosaveStore } from "./use-autosave-store";
import { useFileStore } from "./use-file-store";

export const toggleAutoSave = () => {
  const { enabled, setEnabled } = useAutosaveStore.getState();
  setEnabled(!enabled);
};

/** Header "Resume auto save": asks for permission again; must run from a click. */
export const resumeAutoSave = async () => {
  const { handle } = useFileStore.getState();
  if (!handle) return;
  if ((await requestWritePermission(handle)) !== "granted") {
    toast.error("Write permission was not granted. Auto save stays off.");
    return;
  }
  resumeFileAutosave();
};

/** Header "Retry" after a failed write: re-authorise and write, else fall back to Save As. */
export const retryAutoSave = async () => {
  const { handle, fileName, bridgePath } = useFileStore.getState();
  // A bridge file: try the bridge again (saveFile reports a failure itself).
  if (!handle && bridgePath) return saveFile();
  if (!handle) return saveFileAs();
  try {
    if (!(await ensureWritePermission(handle))) throw new Error("permission denied");
    await writeDocToHandle(handle, fileName ?? handle.name);
  } catch {
    await saveFileAs();
  }
};
