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
