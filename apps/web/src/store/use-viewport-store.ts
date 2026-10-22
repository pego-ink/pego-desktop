import { create } from "zustand";
import type { Box } from "@pego/doc";
import { DEFAULT_CAMERA, type Camera } from "@/canvas/types";
import { clampZoom, fitCamera, zoomAtPoint } from "@/interaction/camera";

type ViewportState = {
  camera: Camera;
  /** Canvas element size in CSS pixels. */
  size: { width: number; height: number };
  /** True once the initial zoom-to-fit ran. */
  fitted: boolean;

  setSize: (width: number, height: number) => void;
  panBy: (dx: number, dy: number) => void;
  setCamera: (camera: Camera) => void;
  /** Multiply zoom by `factor` around screen point (sx, sy). */
  zoomBy: (factor: number, sx: number, sy: number) => void;
  /** Set absolute zoom around screen point (sx, sy). */
  zoomTo: (zoom: number, sx: number, sy: number) => void;
  /** Zoom around the viewport center. */
  zoomCenterBy: (factor: number) => void;
  zoomCenterTo: (zoom: number) => void;
  zoomToFit: (bounds: Box | null) => void;
};

export const useViewportStore = create<ViewportState>((set, get) => ({
  camera: DEFAULT_CAMERA,
  size: { width: 0, height: 0 },
  fitted: false,

  setSize: (width, height) => set({ size: { width, height } }),
  panBy: (dx, dy) =>
    set(({ camera }) => ({
      camera: { ...camera, panX: camera.panX + dx, panY: camera.panY + dy },
    })),
  setCamera: (camera) => set({ camera: { ...camera, zoom: clampZoom(camera.zoom) } }),
  zoomBy: (factor, sx, sy) =>
    set(({ camera }) => ({ camera: zoomAtPoint(camera, camera.zoom * factor, sx, sy) })),
  zoomTo: (zoom, sx, sy) => set(({ camera }) => ({ camera: zoomAtPoint(camera, zoom, sx, sy) })),
  zoomCenterBy: (factor) => {
    const { size } = get();
    get().zoomBy(factor, size.width / 2, size.height / 2);
  },
  zoomCenterTo: (zoom) => {
    const { size } = get();
    get().zoomTo(zoom, size.width / 2, size.height / 2);
  },
  zoomToFit: (bounds) => {
    const { size } = get();
    if (!bounds || size.width === 0 || size.height === 0) return;
    set({ camera: fitCamera(bounds, size), fitted: true });
  },
}));
