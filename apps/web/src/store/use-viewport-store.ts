import { create } from "zustand";
import { prefersReducedMotion } from "@pego/ui/lib/motion";
import type { Box } from "@pego/doc";
import { DEFAULT_CAMERA, type Camera } from "@/canvas/types";
import { clampZoom, fitCamera, zoomAtPoint } from "@/interaction/camera";
import { createCameraAnimator } from "@/interaction/camera-animator";

type ViewportState = {
  camera: Camera;
  /** Canvas element size in CSS pixels. */
  size: { width: number; height: number };
  /** True once the initial zoom-to-fit ran. */
  fitted: boolean;

  setSize: (width: number, height: number) => void;
  /** Direct manipulation (drag-pan): instant, interrupts any camera animation. */
  panBy: (dx: number, dy: number) => void;
  /** Jump to a camera (instant, interrupts any animation). */
  setCamera: (camera: Camera) => void;
  /** Ease to a camera over 250ms (instant with reduced motion). */
  animateTo: (camera: Camera) => void;
  /** Multiply zoom by `factor` around screen point (sx, sy), 1:1 (trackpad pinch). */
  zoomBy: (factor: number, sx: number, sy: number) => void;
  /** Mouse-wheel notch: ease toward `zoom * factor` anchored at the cursor (~120ms). */
  wheelZoomBy: (factor: number, sx: number, sy: number) => void;
  /** Set absolute zoom around screen point (sx, sy). */
  zoomTo: (zoom: number, sx: number, sy: number) => void;
  /** Animated zoom around the viewport center; repeated calls compound on the pending target. */
  zoomCenterBy: (factor: number) => void;
  zoomCenterTo: (zoom: number) => void;
  /** First fit is instant; later fits animate. */
  zoomToFit: (bounds: Box | null) => void;
};

export const useViewportStore = create<ViewportState>((set, get) => {
  const animator = createCameraAnimator({
    getCamera: () => get().camera,
    getSize: () => get().size,
    apply: (camera) => set({ camera }),
    // No window (tests, SSR) has no frames to animate over: jump.
    reducedMotion: () => typeof window === "undefined" || prefersReducedMotion(),
  });
  const centerOf = () => {
    const { size } = get();
    return { x: size.width / 2, y: size.height / 2 };
  };

  return {
    camera: DEFAULT_CAMERA,
    size: { width: 0, height: 0 },
    fitted: false,

    setSize: (width, height) => set({ size: { width, height } }),
    panBy: (dx, dy) => {
      animator.cancel();
      set(({ camera }) => ({
        camera: { ...camera, panX: camera.panX + dx, panY: camera.panY + dy },
      }));
    },
    setCamera: (camera) => {
      animator.cancel();
      set({ camera: { ...camera, zoom: clampZoom(camera.zoom) } });
    },
    animateTo: (camera) => animator.animateTo(camera),
    zoomBy: (factor, sx, sy) => {
      animator.cancel();
      set(({ camera }) => ({ camera: zoomAtPoint(camera, camera.zoom * factor, sx, sy) }));
    },
    wheelZoomBy: (factor, sx, sy) => animator.wheelZoomBy(factor, sx, sy),
    zoomTo: (zoom, sx, sy) => {
      animator.cancel();
      set(({ camera }) => ({ camera: zoomAtPoint(camera, zoom, sx, sy) }));
    },
    zoomCenterBy: (factor) => {
      const base = animator.target();
      const c = centerOf();
      animator.animateTo(zoomAtPoint(base, base.zoom * factor, c.x, c.y));
    },
    zoomCenterTo: (zoom) => {
      const c = centerOf();
      animator.animateTo(zoomAtPoint(animator.target(), zoom, c.x, c.y));
    },
    zoomToFit: (bounds) => {
      const { size, fitted } = get();
      if (!bounds || size.width === 0 || size.height === 0) return;
      const camera = fitCamera(bounds, size);
      if (!fitted) {
        animator.cancel();
        set({ camera, fitted: true });
        return;
      }
      animator.animateTo(camera);
    },
  };
});
