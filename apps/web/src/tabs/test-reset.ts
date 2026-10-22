import { sampleDoc } from "@pego/doc";
import { useFileStore } from "@/persistence/use-file-store";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { useTabsStore } from "./use-tabs-store";

/** One untitled, untouched tab showing the sample document (no viewport: fits are skipped). */
export const resetTabs = () => {
  useViewportStore.setState({ size: { width: 0, height: 0 } });
  useDocumentStore.getState().load(sampleDoc);
  useFileStore.setState({
    fileName: null,
    handle: null,
    bridgePath: null,
    savedDoc: useDocumentStore.getState().doc,
  });
  useTabsStore.setState({ tabs: [{ id: "t0", snapshot: null }], activeId: "t0" });
};

type WindowHolder = { window?: { confirm?: () => boolean } };
let createdWindow = false;
let previousConfirm: (() => boolean) | undefined;

/**
 * Answer `window.confirm` with `answer` in tests. A `window` is created only when there is none,
 * and `restoreConfirm` removes it again, so other suites never see a half-made `window`.
 */
export const stubConfirm = (answer: () => boolean) => {
  const holder = globalThis as WindowHolder;
  if (!holder.window) {
    holder.window = {};
    createdWindow = true;
  } else if (!createdWindow) {
    previousConfirm = holder.window.confirm;
  }
  holder.window.confirm = answer;
};

export const restoreConfirm = () => {
  const holder = globalThis as WindowHolder;
  if (createdWindow) delete holder.window;
  else if (holder.window) holder.window.confirm = previousConfirm;
  createdWindow = false;
  previousConfirm = undefined;
};
