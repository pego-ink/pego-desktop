/**
 * Viewport camera. Screen point (CSS pixels, relative to the canvas element)
 * = document point * zoom + pan.
 */
export type Camera = { panX: number; panY: number; zoom: number };

export const DEFAULT_CAMERA: Camera = { panX: 48, panY: 48, zoom: 1 };

export const docToScreen = (camera: Camera, x: number, y: number) => ({
  x: x * camera.zoom + camera.panX,
  y: y * camera.zoom + camera.panY,
});

export const screenToDoc = (camera: Camera, x: number, y: number) => ({
  x: (x - camera.panX) / camera.zoom,
  y: (y - camera.panY) / camera.zoom,
});
