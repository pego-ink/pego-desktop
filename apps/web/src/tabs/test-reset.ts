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
