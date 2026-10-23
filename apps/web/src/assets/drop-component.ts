import { findNode } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { deepestFrameId } from "@/interaction/create-node";
import { hitPath } from "@/interaction/hit-test";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { dropInstanceOp } from "./components";

/**
 * A component dragged from the Assets panel and dropped on the canvas at screen point (x, y):
 * an instance centered there, inside the deepest frame under the point.
 */
export const dropComponent = (componentId: string, x: number, y: number): boolean => {
  const state = useDocumentStore.getState();
  const component = findNode(state.doc, componentId);
  if (!component?.reusable) return false;
  const layout = getLayout(state.doc);
  const page = activePage(state);
  const at = screenToDoc(useViewportStore.getState().camera, x, y);
  const frameId = deepestFrameId(
    state.doc,
    hitPath(state.doc, layout, at.x, at.y, { pageId: page.id }),
  );
  const frameBox = frameId ? layout.get(frameId) : undefined;
  const size = layout.get(componentId) ?? { width: 0, height: 0 };
  const op = dropInstanceOp(
    { id: component.id, name: component.name ?? "Instance" },
    size,
    at,
    page.id,
    frameId && frameBox ? { id: frameId, x: frameBox.x, y: frameBox.y } : null,
  );
  if (!state.commit([op], { label: `Insert ${component.name ?? "instance"}` })) return false;
  useDocumentStore.getState().select([op.node.id]);
  return true;
};
