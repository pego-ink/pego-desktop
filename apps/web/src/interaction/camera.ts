import { type Box, type Layout, pageOrFirst, type PegoDocument } from "@pego/doc";
import type { Camera } from "../canvas/types";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
export const FIT_PADDING = 48;

/** Zoom change per mouse-wheel notch. */
export const WHEEL_NOTCH_FACTOR = 1.2;
/** A wheel event at least this large (px) is a mouse notch, not a trackpad pinch/scroll sample. */
const DISCRETE_WHEEL_MIN_DELTA = 50;

/**
 * Notched mouse wheels report line deltas or big pixel jumps; trackpads stream small pixel
 * deltas (pinch arrives as ctrl+wheel) and must stay 1:1.
 */
export const isDiscreteWheel = (e: { deltaMode: number; deltaY: number }): boolean =>
  e.deltaMode !== 0 || Math.abs(e.deltaY) >= DISCRETE_WHEEL_MIN_DELTA;

/** Zoom factor for one wheel notch, however large the reported delta is. */
export const wheelNotchFactor = (deltaY: number): number =>
  deltaY < 0 ? WHEEL_NOTCH_FACTOR : deltaY > 0 ? 1 / WHEEL_NOTCH_FACTOR : 1;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Change zoom while keeping the document point under screen point (sx, sy) fixed. */
export const zoomAtPoint = (camera: Camera, nextZoom: number, sx: number, sy: number): Camera => {
  const zoom = clampZoom(nextZoom);
  const docX = (sx - camera.panX) / camera.zoom;
  const docY = (sy - camera.panY) / camera.zoom;
  return { zoom, panX: sx - docX * zoom, panY: sy - docY * zoom };
};

/**
 * The part of the canvas the user can see, in canvas px: all of it, or (floating panels) the
 * area between them. `x`/`y` default to 0.
 */
export type ViewRect = { x?: number; y?: number; width: number; height: number };

/** Camera that centers `bounds` inside the viewport with `padding` px around it. */
export const fitCamera = (bounds: Box, viewport: ViewRect, padding = FIT_PADDING): Camera => {
  const availW = Math.max(viewport.width - padding * 2, 1);
  const availH = Math.max(viewport.height - padding * 2, 1);
  const zoom = clampZoom(
    Math.min(availW / Math.max(bounds.width, 1), availH / Math.max(bounds.height, 1)),
  );
  return {
    zoom,
    panX: (viewport.x ?? 0) + (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    panY: (viewport.y ?? 0) + (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
};

/** Union of the top-level node boxes of a page (null = the first), or null for an empty page. */
export const contentBounds = (
  doc: PegoDocument,
  layout: Layout,
  pageId: string | null = null,
): Box | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of pageOrFirst(doc, pageId).children) {
    const box = layout.get(node.id);
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};
