import { toast } from "sonner";
import { importPen, type PegoDocument } from "@pego/doc";
import { saveFileViaBridge } from "@/agent/bridge-client";
import { newTab, openTab } from "@/tabs/use-tabs-store";
import { activateWorkspace, SCRATCH_ID } from "@/workspace/use-workspace-store";
import { useDocumentStore } from "@/store/use-document-store";
import {
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

const PEN_EXTENSION = ".pen";
const PICKER_TYPES = [{ description: "Pego file", accept: { [FILE_MIME]: [FILE_EXTENSION] } }];
const OPEN_PICKER_TYPES = [
  { description: "Pego or Pencil file", accept: { [FILE_MIME]: [FILE_EXTENSION, PEN_EXTENSION] } },
];
const MAX_LISTED_WARNINGS = 4;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
    input.accept = `${FILE_EXTENSION},${PEN_EXTENSION},${FILE_MIME}`;
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
      [handle = null] = await showOpenFilePicker({ types: OPEN_PICKER_TYPES, multiple: false });
      file = handle ? await handle.getFile() : null;
    } else {
      file = await readTextViaInput();
    }
    if (!file) return;
    if (file.name.toLowerCase().endsWith(PEN_EXTENSION)) return importPenFile(file);
    adopt(parseDocumentFile(await file.text()), file.name, handle);
  } catch (error) {
    if (isAbortError(error)) return;
    toast.error(`Could not open file: ${errorMessage(error)}`);
  }
};

/** Opens a Pencil file as a new, unsaved `.pego` document; the `.pen` file is never written. */
const importPenFile = async (file: File) => {
  const base = file.name.slice(0, -PEN_EXTENSION.length) || "Imported";
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("Not a valid .pen file: the content is not valid JSON.");
  }
  const { doc, warnings } = importPen(raw, base);
  if (!activateWorkspace(SCRATCH_ID)) return;
  if (openTab(doc, { fileName: `${base}${FILE_EXTENSION}` }, { saved: false }) !== "opened") return;
  if (warnings.length === 0) {
    toast.success(`Imported ${file.name}`);
    return;
  }
  const listed = warnings
    .slice(0, MAX_LISTED_WARNINGS)
    .map((w) => (w.count > 1 ? `${w.message} (${w.count}×)` : w.message));
  const more = warnings.length - listed.length;
  toast.warning(`Imported ${file.name} with changes`, {
    description: [...listed, ...(more > 0 ? [`and ${more} more`] : [])].join("\n"),
    duration: 10_000,
  });
};

/** Open a `.pego` or `.pen` file dropped on the canvas (no handle: Save asks where to save). */
export const openDroppedFile = async (file: File) => {
  try {
    if (file.name.toLowerCase().endsWith(PEN_EXTENSION)) return await importPenFile(file);
    adopt(parseDocumentFile(await file.text()), file.name, null);
  } catch (error) {
    toast.error(`Could not open ${file.name}: ${errorMessage(error)}`);
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

/** Write back to the file on disk that Claude Code opened (through the local bridge). */
const saveToBridgePath = async (path: string) => {
  const { doc } = useDocumentStore.getState();
  try {
    await saveFileViaBridge(path, serializeDocument(doc));
    useFileStore.getState().markSaved(doc, path.split(/[\\/]/).pop() ?? path, null, path);
  } catch (error) {
    toast.error(`Could not save to ${path}: ${errorMessage(error)}`);
  }
};

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
  if (!handle && bridgePath) return saveToBridgePath(bridgePath);
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
