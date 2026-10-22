import { sampleDoc } from "@pego/doc";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useTabsStore } from "./use-tabs-store";

/** One untitled, untouched tab showing the sample document. */
export const resetTabs = () => {
  useDocumentStore.getState().load(sampleDoc);
  useFileStore.setState({
    fileName: null,
    handle: null,
    bridgePath: null,
    savedDoc: useDocumentStore.getState().doc,
  });
  useTabsStore.setState({ tabs: [{ id: "t0", snapshot: null }], activeId: "t0" });
};

let createdWindow = false;

/**
 * Point `window.confirm` at `confirm` for this test file. Bun runs every file in one process, so a
 * `window` created here is removed again by `releaseWindow` (other suites expect none).
 */
export const stubConfirm = (confirm: () => boolean): void => {
  const scope = globalThis as { window?: { confirm?: () => boolean } };
  if (!scope.window) {
    scope.window = {};
    createdWindow = true;
  }
  scope.window.confirm = confirm;
};

export const releaseWindow = (): void => {
  if (!createdWindow) return;
  delete (globalThis as { window?: unknown }).window;
  createdWindow = false;
};
