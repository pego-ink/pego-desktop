import { createId, pageOrFirst, type Box, type Op, type PegoDocument } from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { focusCamera } from "@/agent/focus-camera";
import { freeFrameSpot, type FramePreset } from "@/interaction/frame-presets";
import { uniqueName } from "@/interaction/create-node";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";
import { useViewportStore } from "@/store/use-viewport-store";

/** Insert op for a white, clipping top-level frame named after the preset. */
export const presetFrameOp = (
  doc: PegoDocument,
  box: Box,
  preset: FramePreset,
  id: string,
  /** Page the frame goes on (null = the first); `parentId: null` lands on the shown page. */
  pageId: string | null = null,
): Op => ({
  op: "insert",
  parentId: null,
  node: {
    type: "frame",
    id,
    name: uniqueName(preset.name, pageOrFirst(doc, pageId).children),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fill: "#FFFFFF",
    clip: true,
    layout: "none",
    children: [],
  },
});

/**
 * Create a preset-sized frame in free top-level space as one undo step, select it, zoom to it
 * and hand the tool back to select.
 */
export const insertPresetFrame = (preset: FramePreset): string | null => {
  const store = useDocumentStore.getState();
  const { doc, pageId } = store;
  const layout = getLayout(doc);
  const occupied = pageOrFirst(doc, pageId).children.flatMap((node) => layout.get(node.id) ?? []);
  const box = freeFrameSpot(occupied, preset);
  const id = createId();
  const ok = store.commit([presetFrameOp(doc, box, preset, id, pageId)], {
    label: `Create ${preset.name} frame`,
  });
  if (!ok) return null;
  useDocumentStore.getState().select([id]);
  useToolStore.getState().setTool("select");
  const viewport = useViewportStore.getState();
  const camera = focusCamera([box], viewport.size);
  if (camera) viewport.animateTo(camera);
  return id;
};
