import { setConnectorsShown } from "@/canvas/layout";
import { useLayerEvents } from "@/canvas/layer-events";
import { useDocumentStore } from "@/store/use-document-store";
import { useSettingsStore } from "@/store/use-settings-store";
import { useToolStore } from "@/store/use-tool-store";

/**
 * Follows the "Wireflow connectors" setting: hides or shows connectors on the canvas, and when
 * they are hidden leaves the Connector tool and drops hidden connectors from the selection.
 */
const apply = (shown: boolean) => {
  setConnectorsShown(shown);
  if (!shown) {
    if (useToolStore.getState().tool === "connector") useToolStore.getState().setTool("select");
    const { doc, selection, select } = useDocumentStore.getState();
    const kept = selection.filter((id) => !isConnector(doc.children, id));
    if (kept.length !== selection.length) select(kept);
  }
  useLayerEvents.getState().invalidate();
};

const isConnector = (
  nodes: readonly { id: string; type: string; children?: unknown }[],
  id: string,
): boolean =>
  nodes.some(
    (node) =>
      (node.id === id && node.type === "connector") ||
      (Array.isArray(node.children) && isConnector(node.children as typeof nodes, id)),
  );

apply(useSettingsStore.getState().connectors);
useSettingsStore.subscribe((state, previous) => {
  if (state.connectors !== previous.connectors) apply(state.connectors);
});
