import type { Box } from "@pego/doc";
import type { Camera } from "@/canvas/types";
import { clampZoom, FIT_PADDING } from "@/interaction/camera";

/** Smallest box containing every box, or null for an empty list. */
export const unionBoxes = (boxes: readonly Box[]): Box | null => {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Camera that centers the union of `boxes` in the viewport with `padding` px around it. Zooms
 * out as needed to fit, but never in past `maxZoom` (small nodes are centered, not blown up).
 * Null when there is nothing to show or the viewport has no size.
 */
export const focusCamera = (
  boxes: readonly Box[],
  viewport: { width: number; height: number },
  { padding = FIT_PADDING, maxZoom = 1 }: { padding?: number; maxZoom?: number } = {},
): Camera | null => {
  const bounds = unionBoxes(boxes);
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return null;
  const availW = Math.max(viewport.width - padding * 2, 1);
  const availH = Math.max(viewport.height - padding * 2, 1);
  const fit = Math.min(availW / Math.max(bounds.width, 1), availH / Math.max(bounds.height, 1));
  const zoom = clampZoom(Math.min(fit, maxZoom));
  return {
    zoom,
    panX: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    panY: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
};
