import { toast } from "sonner";
import { getLayout } from "@/canvas/layout";
import { screenToDoc } from "@/canvas/types";
import { hitPath } from "@/interaction/hit-test";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";
import { deepestNestableFrameId, dropInstanceOp, nodeIndex } from "./components";

/**
 * A component dragged from the Assets panel and dropped on the canvas at screen point (x, y):
 * an instance centered there, inside the deepest frame under the point that cannot make a cycle
 * (never the component itself, anything inside it, or inside a component it instantiates).
 */
export const dropComponent = (componentId: string, x: number, y: number): boolean => {
  const state = useDocumentStore.getState();
  const component = nodeIndex(state.doc).get(componentId);
  if (!component?.reusable) {
    toast.error("That component no longer exists.");
    return false;
  }
  const layout = getLayout(state.doc);
  const page = activePage(state);
  const at = screenToDoc(useViewportStore.getState().camera, x, y);
  const frameId = deepestNestableFrameId(
    state.doc,
    hitPath(state.doc, layout, at.x, at.y, { pageId: page.id }),
    componentId,
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
  // A rejected commit is toasted by the store.
  if (!state.commit([op], { label: `Insert ${component.name ?? "instance"}` })) return false;
  useDocumentStore.getState().select([op.node.id]);
  return true;
};
