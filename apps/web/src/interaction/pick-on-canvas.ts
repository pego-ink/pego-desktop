import type { Layout, PegoDocument } from "@pego/doc";
import { captionAt, frameCaptions } from "@/canvas/frame-captions";
import { screenToDoc, type Camera } from "@/canvas/types";
import { HIT_TOLERANCE_PX } from "./hit-test";
import { pickAt } from "./selection";

export type PickState = {
  doc: PegoDocument;
  selection: readonly string[];
  pageId: string | null;
};

/**
 * The layer a click (left or right) at canvas point `screen` picks: a frame's caption picks the
 * frame itself, anything else the layer under the pointer (`deep`: ⌘/Ctrl, the innermost one).
 */
export const pickOnCanvas = (
  state: PickState,
  layout: Layout,
  camera: Camera,
  screen: { x: number; y: number },
  deep: boolean,
): string | null => {
  const captioned = captionAt(
    frameCaptions(state.doc, layout, camera, state.pageId),
    screen.x,
    screen.y,
  );
  if (captioned) return captioned;
  const at = screenToDoc(camera, screen.x, screen.y);
  return pickAt(state.doc, layout, at.x, at.y, state.selection, deep, {
    tolerance: HIT_TOLERANCE_PX / camera.zoom,
    pageId: state.pageId,
  });
};
