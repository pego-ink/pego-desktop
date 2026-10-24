import type { Box } from "@pego/doc";
import { visibleArea } from "@/canvas/cull";
import type { Camera } from "@/canvas/types";

/**
 * The canvas renders the document into a cached layer larger than the view (a margin on every
 * side) and, while the camera moves, only redraws that bitmap shifted and scaled: panning within
 * the margin and zooming up to MAX_UPSCALE cost one image draw. The layer is rendered again when
 * the view leaves it, when zooming in past the limit, when anything it shows changes, and shortly
 * after a zoom ends so text and edges are crisp at the new scale.
 */

/** Margin around the view, in device pixels. */
export const CONTENT_PADDING_PX = 512;
/** Zooming in further than this over the rendered zoom looks too soft: render again. */
export const MAX_UPSCALE = 3;
/** After the camera stops at a new zoom, render again at that zoom this much later (ms). */
export const SETTLE_MS = 200;

/** Where and how the cached layer was rendered (all CSS px). */
export type RenderedView = {
  panX: number;
  panY: number;
  zoom: number;
  /** Margin around the view, CSS px. */
  padding: number;
  /** The view size it was rendered for. */
  width: number;
  height: number;
};

/** The camera the layer is rendered with: the view's, moved by the margin. */
export const layerCamera = (view: RenderedView): Camera => ({
  panX: view.panX + view.padding,
  panY: view.panY + view.padding,
  zoom: view.zoom,
});

/** The layer's size in CSS px. */
export const layerSize = (view: RenderedView) => ({
  width: view.width + view.padding * 2,
  height: view.height + view.padding * 2,
});

/** The document area the layer holds. */
export const renderedArea = (view: RenderedView): Box => {
  const size = layerSize(view);
  return visibleArea(layerCamera(view), size.width, size.height);
};

const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/** Whether the layer still covers the view at `camera` (a `width` x `height` CSS px view). */
export const canReuse = (
  view: RenderedView,
  camera: Camera,
  width: number,
  height: number,
): boolean =>
  view.width === width &&
  view.height === height &&
  camera.zoom <= view.zoom * MAX_UPSCALE &&
  contains(renderedArea(view), visibleArea(camera, width, height));

/** How to draw the layer for `camera`: screen = layer * scale + (x, y), all CSS px. */
export const layerToScreen = (view: RenderedView, camera: Camera) => {
  const scale = camera.zoom / view.zoom;
  const origin = layerCamera(view);
  return {
    scale,
    x: camera.panX - origin.panX * scale,
    y: camera.panY - origin.panY * scale,
  };
};
