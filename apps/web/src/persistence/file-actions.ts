import { toast } from "sonner";
import type { PegoDocument } from "@pego/doc";
import { useDocumentStore } from "@/store/use-document-store";
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
import { getIsDirty, useFileStore } from "./use-file-store";

const PICKER_TYPES = [{ description: "Pego file", accept: { [FILE_MIME]: [FILE_EXTENSION] } }];

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const confirmDiscard = (action: string) =>
  !getIsDirty() || window.confirm(`You have unsaved changes. ${action} anyway?`);

const adopt = (doc: PegoDocument, fileName: string | null, handle: PegoFileHandle | null) => {
  useDocumentStore.getState().load(doc);
  useFileStore.getState().markSaved(useDocumentStore.getState().doc, fileName, handle);
};

export const newDocument = () => {
  if (!confirmDiscard("Create a new document")) return;
  adopt(createEmptyDocument(), null, null);
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
  if (!confirmDiscard("Open another file")) return;
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

const hasWritePermission = async (handle: PegoFileHandle) => {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
};

const writeToHandle = async (handle: PegoFileHandle, text: string) => {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
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
    await writeToHandle(handle, text);
    useFileStore.getState().markSaved(doc, handle.name, handle);
  } catch (error) {
    if (isAbortError(error)) return;
    toast.error(`Could not save file: ${errorMessage(error)}`);
  }
};

export const saveFile = async () => {
  const { handle, fileName } = useFileStore.getState();
  if (!handle) return saveFileAs();
  const { doc } = useDocumentStore.getState();
  try {
    if (!(await hasWritePermission(handle))) {
      toast.error("Write permission was denied. Choose where to save.");
      return saveFileAs();
    }
    await writeToHandle(handle, serializeDocument(doc));
    useFileStore.getState().markSaved(doc, fileName ?? handle.name, handle);
  } catch (error) {
    toast.error(`Could not save file: ${errorMessage(error)}`);
  }
};
