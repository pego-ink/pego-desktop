import type { Box, Layout } from "@pego/doc";

/** Zoom factor for one zoom-in / zoom-out step (keyboard shortcuts and the zoom control). */
export const ZOOM_STEP = 1.25;

/** Union of the boxes of the given nodes, or null when none has a layout box. */
export const selectionBounds = (layout: Layout, ids: readonly string[]): Box | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const box = layout.get(id);
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Zoom as a whole percent, e.g. 1.256 -> "126%". */
export const formatZoomPercent = (zoom: number): string => `${Math.round(zoom * 100)}%`;
