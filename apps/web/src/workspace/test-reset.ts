import { sampleDoc } from "@pego/doc";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { SCRATCH_ID, useWorkspaceStore } from "./use-workspace-store";

/**
 * The sample document, untitled and untouched, as the live document of the scratch workspace.
 * The viewport has no size, so fits are skipped (another suite's size would make them animate,
 * which needs a real `window.matchMedia`).
 */
export const resetLiveDocument = () => {
  useViewportStore.setState({ size: { width: 0, height: 0 } });
  useWorkspaceStore.setState({
    workspaces: [{ id: SCRATCH_ID, name: "Scratch", dir: null, kind: "scratch", saved: null }],
    liveId: SCRATCH_ID,
    view: "editor",
  });
  useDocumentStore.getState().load(sampleDoc);
  useFileStore.setState({
    fileName: null,
    handle: null,
    bridgePath: null,
    savedDoc: useDocumentStore.getState().doc,
  });
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
