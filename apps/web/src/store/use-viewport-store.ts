import { create } from "zustand";
import { prefersReducedMotion } from "@pego/ui/lib/motion";
import type { Box } from "@pego/doc";
import { DEFAULT_CAMERA, type Camera } from "@/canvas/types";
import { clampZoom, fitCamera, zoomAtPoint } from "@/interaction/camera";
import { createCameraAnimator } from "@/interaction/camera-animator";

/** Canvas px covered by floating panels on each side (0 when the panels are docked). */
export type ViewInsets = { top: number; right: number; bottom: number; left: number };

const NO_INSETS: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Smallest visible side (px) worth fitting into; below it fits use the whole canvas. */
const MIN_VISIBLE = 200;

type ViewportState = {
  camera: Camera;
  /** Canvas element size in CSS pixels. */
  size: { width: number; height: number };
  /** Parts of the canvas hidden behind floating panels (see `visibleRect`). */
  insets: ViewInsets;
  /** True once the initial zoom-to-fit ran. */
  fitted: boolean;

  setSize: (width: number, height: number) => void;
  setInsets: (insets: ViewInsets | null) => void;
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

/**
 * The part of the canvas the user can see, in canvas px: the whole element, minus what floating
 * panels cover. Fits, zoom buttons and "the middle of the view" use it.
 */
export const visibleRect = (state: {
  size: { width: number; height: number };
  insets: ViewInsets;
}): { x: number; y: number; width: number; height: number } => {
  const { size, insets } = state;
  const width = size.width - insets.left - insets.right;
  const height = size.height - insets.top - insets.bottom;
  // Too little left between the panels to fit anything into: use the whole canvas.
  if (width < MIN_VISIBLE || height < MIN_VISIBLE)
    return { x: 0, y: 0, width: size.width, height: size.height };
  return { x: insets.left, y: insets.top, width, height };
};

export const useViewportStore = create<ViewportState>((set, get) => {
  const animator = createCameraAnimator({
    getCamera: () => get().camera,
    getSize: () => visibleRect(get()),
    apply: (camera) => set({ camera }),
    // No window (tests, SSR) has no frames to animate over: jump.
    reducedMotion: () => typeof window === "undefined" || prefersReducedMotion(),
  });
  const centerOf = () => {
    const rect = visibleRect(get());
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };

  return {
    camera: DEFAULT_CAMERA,
    size: { width: 0, height: 0 },
    insets: NO_INSETS,
    fitted: false,

    setSize: (width, height) => set({ size: { width, height } }),
    setInsets: (insets) => {
      const next = insets ?? NO_INSETS;
      const current = get().insets;
      if (
        next.top !== current.top ||
        next.right !== current.right ||
        next.bottom !== current.bottom ||
        next.left !== current.left
      )
        set({ insets: next });
    },
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
      const camera = fitCamera(bounds, visibleRect(get()));
      if (!fitted) {
        animator.cancel();
        set({ camera, fitted: true });
        return;
      }
      animator.animateTo(camera);
    },
  };
});

/** The middle of the visible part of the canvas, in canvas px. */
export const viewportCenter = (): { x: number; y: number } => {
  const rect = visibleRect(useViewportStore.getState());
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};
