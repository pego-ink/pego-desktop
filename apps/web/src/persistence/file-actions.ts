import { toast } from "sonner";
import type { PegoDocument } from "@pego/doc";
import { requestProject, saveFileViaBridge } from "@/agent/bridge-client";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { blockedByRun, loadIntoActive, newTab, openTab } from "@/tabs/use-tabs-store";
import { activateWorkspace, SCRATCH_ID } from "@/workspace/use-workspace-store";
import {
  createEmptyDocument,
  DEFAULT_FILE_NAME,
  FILE_EXTENSION,
  FILE_MIME,
  parseDocumentFile,
  serializeDocument,
} from "./file-format";
import {
  isAbortError,
  getOpenFilePicker,
  getSaveFilePicker,
  type PegoFileHandle,
} from "./fs-access";
import { noteManualSave, runExclusiveSave } from "./file-autosave";
import { ensureWritePermission, writeToHandle } from "./file-permission";
import { useFileStore } from "./use-file-store";

const PICKER_TYPES = [{ description: "Pego file", accept: { [FILE_MIME]: [FILE_EXTENSION] } }];

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Files opened from disk (not a project's design) are scratch documents. */
const adopt = (doc: PegoDocument, fileName: string | null, handle: PegoFileHandle | null) => {
  if (!activateWorkspace(SCRATCH_ID)) return;
  openTab(doc, { fileName, handle });
};

export const newDocument = () => {
  if (!activateWorkspace(SCRATCH_ID)) return;
  newTab();
};

const readTextViaInput = () =>
  new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${FILE_EXTENSION},${FILE_MIME}`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });

export const openFile = async () => {
  try {
    let file: File | null;
    let handle: PegoFileHandle | null = null;
    const showOpenFilePicker = getOpenFilePicker();
    if (showOpenFilePicker) {
      [handle = null] = await showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      file = handle ? await handle.getFile() : null;
    } else {
      file = await readTextViaInput();
    }
    if (!file) return;
    adopt(parseDocumentFile(await file.text()), file.name, handle);
  } catch (error) {
    if (isAbortError(error)) return;
    toast.error(`Could not open file: ${errorMessage(error)}`);
  }
};

const downloadFile = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: FILE_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Writes the current doc to a handle inside the autosave queue, then marks it clean. */
export const writeDocToHandle = (handle: PegoFileHandle, fileName: string) =>
  runExclusiveSave(async () => {
    const { doc } = useDocumentStore.getState();
    await writeToHandle(handle, serializeDocument(doc));
    useFileStore.getState().markSaved(doc, fileName, handle);
    noteManualSave();
  });

/**
 * Writes the current doc to a file on disk through the local bridge (a project's design, or a
 * file Claude Code opened), inside the autosave queue, then marks it clean.
 */
export const writeDocToBridgePath = (path: string) =>
  runExclusiveSave(async () => {
    const { doc } = useDocumentStore.getState();
    await saveFileViaBridge(path, serializeDocument(doc));
    useFileStore.getState().markSaved(doc, fileNameOf(path), null, path);
    noteManualSave();
  });

export const saveFileAs = async () => {
  const { doc } = useDocumentStore.getState();
  const text = serializeDocument(doc);
  const suggested = useFileStore.getState().fileName ?? DEFAULT_FILE_NAME;
  try {
    const showSaveFilePicker = getSaveFilePicker();
    if (!showSaveFilePicker) {
      downloadFile(suggested, text);
      useFileStore.getState().markSaved(doc, suggested, null);
      toast.success(`Downloaded ${suggested}`);
      return;
    }
    const handle = await showSaveFilePicker({ suggestedName: suggested, types: PICKER_TYPES });
    await writeDocToHandle(handle, handle.name);
  } catch (error) {
    if (isAbortError(error)) return;
    toast.error(`Could not save file: ${errorMessage(error)}`);
  }
};

export const saveFile = async () => {
  const { handle, fileName, bridgePath } = useFileStore.getState();
  if (!handle && bridgePath) {
    try {
      await writeDocToBridgePath(bridgePath);
    } catch (error) {
      toast.error(`Could not save to ${bridgePath}: ${errorMessage(error)}`);
    }
    return;
  }
  if (!handle) return saveFileAs();
  try {
    if (!(await ensureWritePermission(handle))) {
      toast.error("Write permission was denied. Choose where to save.");
      return saveFileAs();
    }
    await writeDocToHandle(handle, fileName ?? handle.name);
  } catch (error) {
    toast.error(`Could not save file: ${errorMessage(error)}`);
  }
};

/** The shown document as a project's design: same content, named after the project. */
export const asProjectDocument = (doc: PegoDocument, name: string): PegoDocument => ({
  ...doc,
  name,
});

/**
 * Turn the shown document into a new project: create the project folder through the bridge,
 * write the document as its project.pego and open the project. A document that was never saved
 * to a file moves into the project (the scratch area gets a new empty document); one with a
 * file stays as it is, so this also duplicates a project.
 */
export const saveAsProject = async () => {
  if (!useAgentStore.getState().bridge.connected) {
    toast.error("Saving as a project needs the Pego bridge (bun run bridge, or the desktop app).");
    return;
  }
  if (blockedByRun()) return;
  const { doc } = useDocumentStore.getState();
  const suggested = doc.name && doc.name !== "Untitled" ? doc.name : "";
  const name = window.prompt("Project name", suggested)?.trim();
  if (!name) return;
  try {
    const { project } = await requestProject("create_project", undefined, name);
    if (!project) throw new Error("the bridge did not return the project");
    await saveFileViaBridge(
      project.mainFile,
      serializeDocument(asProjectDocument(useDocumentStore.getState().doc, project.name)),
    );
    const { handle, bridgePath } = useFileStore.getState();
    if (!handle && !bridgePath) loadIntoActive(createEmptyDocument(), {}, true);
    const [{ openProject }, { refreshProjects }] = await Promise.all([
      import("@/project/use-project-store"),
      import("@/workspace/use-dashboard-store"),
    ]);
    await openProject(project);
    void refreshProjects();
    toast.success(`Saved as project ${project.name}`, { description: project.dir });
  } catch (error) {
    toast.error(`Could not save as a project: ${errorMessage(error)}`);
  }
};
