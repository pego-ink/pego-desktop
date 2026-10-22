import { useEffect } from "react";
import { useDocumentStore } from "@/store/use-document-store";
import { isTextEditing } from "@/store/use-text-edit-store";
import { readAutosave, writeAutosave } from "./autosave-db";
import { openFile, saveFile, saveFileAs } from "./file-actions";
import { getIsDirty, useFileStore } from "./use-file-store";

const AUTOSAVE_DELAY_MS = 800;

/** True while a debounced autosave is scheduled or being written. */
let autosavePending = false;

const writeCurrent = async () => {
  const { doc } = useDocumentStore.getState();
  const { fileName, handle } = useFileStore.getState();
  await writeAutosave({ doc, fileName, handle, dirty: getIsDirty(), savedAt: Date.now() });
};

const restoreAutosave = async () => {
  const record = await readAutosave();
  if (!record) return;
  useDocumentStore.getState().load(record.doc);
  const loaded = useDocumentStore.getState().doc;
  useFileStore.getState().setSession({
    fileName: record.fileName,
    handle: record.handle,
    savedDoc: record.dirty ? null : loaded,
  });
};

const handleShortcut = (event: KeyboardEvent) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || isTextEditing()) return;
  const key = event.key.toLowerCase();
  const action =
    key === "s"
      ? event.shiftKey
        ? saveFileAs
        : saveFile
      : key === "o" && !event.shiftKey
        ? openFile
        : null;
  if (!action) return;
  event.preventDefault();
  void action();
};

const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!(autosavePending && getIsDirty())) return;
  event.preventDefault();
};

/** Restores the autosave on startup, then autosaves, registers file shortcuts and the unload guard. */
export const usePersistence = () => {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const schedule = () => {
      autosavePending = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void writeCurrent().finally(() => {
          autosavePending = timer !== undefined;
        });
      }, AUTOSAVE_DELAY_MS);
    };

    void restoreAutosave().then(() => {
      if (cancelled) return;
      const unsubDoc = useDocumentStore.subscribe((s, prev) => {
        if (s.doc !== prev.doc) schedule();
      });
      const unsubFile = useFileStore.subscribe(schedule);
      unsubscribe = () => {
        unsubDoc();
        unsubFile();
      };
    });

    window.addEventListener("keydown", handleShortcut, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener("keydown", handleShortcut, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
};
