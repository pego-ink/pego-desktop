import type { Box, Layout, PegoDocument } from "@pego/doc";
import type { Camera } from "../canvas/types";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
export const FIT_PADDING = 48;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Change zoom while keeping the document point under screen point (sx, sy) fixed. */
export const zoomAtPoint = (camera: Camera, nextZoom: number, sx: number, sy: number): Camera => {
  const zoom = clampZoom(nextZoom);
  const docX = (sx - camera.panX) / camera.zoom;
  const docY = (sy - camera.panY) / camera.zoom;
  return { zoom, panX: sx - docX * zoom, panY: sy - docY * zoom };
};

/** Camera that centers `bounds` inside the viewport with `padding` px around it. */
export const fitCamera = (
  bounds: Box,
  viewport: { width: number; height: number },
  padding = FIT_PADDING,
): Camera => {
  const availW = Math.max(viewport.width - padding * 2, 1);
  const availH = Math.max(viewport.height - padding * 2, 1);
  const zoom = clampZoom(
    Math.min(availW / Math.max(bounds.width, 1), availH / Math.max(bounds.height, 1)),
  );
  return {
    zoom,
    panX: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    panY: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
};

/** Union of all top-level node boxes, or null for an empty document. */
export const contentBounds = (doc: PegoDocument, layout: Layout): Box | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of doc.children) {
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
