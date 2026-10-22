import type { Box, Layout, PegoDocument } from "@pego/doc";
import { frameCorners, getSelectionFrame } from "./selection-frame";

/** Zoom factor for one zoom-in / zoom-out step (keyboard shortcuts and the zoom control). */
export const ZOOM_STEP = 1.25;

/**
 * Union of the boxes of the given nodes, or null when none has a layout box. With `doc`, rotated
 * nodes (or nodes inside rotated parents) count with their rotated outline, as the canvas shows it.
 */
export const selectionBounds = (
  layout: Layout,
  ids: readonly string[],
  doc?: PegoDocument,
): Box | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const frame = doc ? getSelectionFrame(doc, layout, id) : null;
    const corners = frame
      ? frameCorners(frame.matrix, frame.box.width, frame.box.height)
      : boxCorners(layout.get(id));
    for (const corner of corners) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const boxCorners = (box: Box | undefined) =>
  box
    ? [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
      ]
    : [];

/** Zoom as a whole percent, e.g. 1.256 -> "126%". */
export const formatZoomPercent = (zoom: number): string => `${Math.round(zoom * 100)}%`;
