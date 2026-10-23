import { collectIds, findNode, type Layout, type PegoDocument } from "@pego/doc";
import { captionAt, frameCaptions } from "@/canvas/frame-captions";
import { screenToDoc, type Camera } from "@/canvas/types";
import { HIT_TOLERANCE_PX } from "./hit-test";
import { pickAt } from "./selection";
import { selectionBounds } from "./zoom-utils";

export type PickState = {
  doc: PegoDocument;
  selection: readonly string[];
  pageId: string | null;
};

type Point = { x: number; y: number };

/**
 * The layer a click (left or right) at canvas point `screen` picks: a frame's caption picks the
 * frame itself, anything else the layer under the pointer (`deep`: ⌘/Ctrl, the innermost one).
 */
export const pickOnCanvas = (
  state: PickState,
  layout: Layout,
  camera: Camera,
  screen: Point,
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

/** `id` is a selected layer or sits inside one. */
const inSelectionTree = (doc: PegoDocument, selection: readonly string[], id: string) =>
  selection.some((selected) => {
    const node = findNode(doc, selected);
    return node ? collectIds(node).has(id) : false;
  });

/**
 * What a right-click at `screen` acts on, like pen.dev: a layer that is (or sits inside) the
 * selection keeps the selection, another layer becomes the selection, and a miss keeps the
 * selection while it is inside the selection's bounds. `empty`: nothing to act on (the short
 * canvas menu).
 */
export const contextMenuTarget = (
  state: PickState,
  layout: Layout,
  camera: Camera,
  screen: Point,
  deep: boolean,
): { selection: readonly string[]; empty: boolean } => {
  const hit = pickOnCanvas(state, layout, camera, screen, deep);
  if (hit) {
    const keep = inSelectionTree(state.doc, state.selection, hit);
    return { selection: keep ? state.selection : [hit], empty: false };
  }
  const bounds = selectionBounds(layout, state.selection, state.doc);
  const at = screenToDoc(camera, screen.x, screen.y);
  const inside =
    bounds !== null &&
    at.x >= bounds.x &&
    at.x <= bounds.x + bounds.width &&
    at.y >= bounds.y &&
    at.y <= bounds.y + bounds.height;
  return inside ? { selection: state.selection, empty: false } : { selection: [], empty: true };
};
