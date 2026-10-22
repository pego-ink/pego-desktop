import type { Camera } from "@/canvas/types";
import { clampZoom, zoomAtPoint } from "@/interaction/camera";

/** Move-on-screen curve (ease-in-out) and duration shared with the UI motion tokens. */
export const CAMERA_EASE = [0.77, 0, 0.175, 1] as const;
export const CAMERA_DURATION_MS = 250;
/** Time constant of the wheel-zoom chase: about 98% settled after ~120ms. */
export const WHEEL_TAU_MS = 28;
const SETTLE_EPSILON = 0.002;

/** Solve a CSS cubic-bezier(x1, y1, x2, y2) easing: progress `t` (0..1) -> eased value. */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const sample = (a1: number, a2: number, u: number) =>
    ((1 - 3 * a2 + 3 * a1) * u + (3 * a2 - 6 * a1)) * u * u + 3 * a1 * u;
  const slope = (a1: number, a2: number, u: number) =>
    3 * (1 - 3 * a2 + 3 * a1) * u * u + 2 * (3 * a2 - 6 * a1) * u + 3 * a1;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sample(x1, x2, u) - x;
      if (Math.abs(err) < 1e-6) return sample(y1, y2, u);
      const d = slope(x1, x2, u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    // Newton stalled on a flat slope: bisect.
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 24; i++) {
      const v = sample(x1, x2, u);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sample(y1, y2, u);
  };
};

const easeInOut = cubicBezier(...CAMERA_EASE);

export type Viewport = { width: number; height: number };

/**
 * Camera at progress `t` between two cameras: zoom moves geometrically (constant perceived
 * speed) and the viewport centre travels in document space, so the motion reads as one move.
 */
export const interpolateCamera = (from: Camera, to: Camera, size: Viewport, t: number): Camera => {
  if (t >= 1) return to;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const fromX = (cx - from.panX) / from.zoom;
  const fromY = (cy - from.panY) / from.zoom;
  const toX = (cx - to.panX) / to.zoom;
  const toY = (cy - to.panY) / to.zoom;
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t);
  const docX = fromX + (toX - fromX) * t;
  const docY = fromY + (toY - fromY) * t;
  return { zoom, panX: cx - docX * zoom, panY: cy - docY * zoom };
};

type Motion =
  | { kind: "tween"; from: Camera; to: Camera; startedAt: number; duration: number }
  | { kind: "chase"; zoom: number; sx: number; sy: number; last: number };

export type CameraAnimatorDeps = {
  getCamera: () => Camera;
  getSize: () => Viewport;
  /** Write a camera to the store without cancelling the animation. */
  apply: (camera: Camera) => void;
  reducedMotion: () => boolean;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
};

/**
 * Drives the viewport camera over time: a timed ease-in-out tween (zoom to fit, focus, zoom
 * shortcuts) and an exponential chase for mouse-wheel zoom. Any user input calls `cancel()`
 * so the camera never fights the hand. Reduced motion jumps straight to the target.
 */
export const createCameraAnimator = (deps: CameraAnimatorDeps) => {
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  let motion: Motion | null = null;
  let frame = 0;

  const stop = () => {
    motion = null;
    if (frame) caf(frame);
    frame = 0;
  };

  const tick = () => {
    frame = 0;
    const current = motion;
    if (!current) return;
    const time = now();
    if (current.kind === "tween") {
      const t = Math.min(1, (time - current.startedAt) / current.duration);
      deps.apply(interpolateCamera(current.from, current.to, deps.getSize(), easeInOut(t)));
      if (t >= 1) motion = null;
    } else {
      const camera = deps.getCamera();
      const dt = Math.max(0, time - current.last);
      current.last = time;
      const ratio = Math.log(current.zoom / camera.zoom);
      const settled = Math.abs(ratio) < SETTLE_EPSILON;
      const alpha = 1 - Math.exp(-dt / WHEEL_TAU_MS);
      const nextZoom = settled ? current.zoom : camera.zoom * Math.exp(ratio * alpha);
      deps.apply(zoomAtPoint(camera, nextZoom, current.sx, current.sy));
      if (settled) motion = null;
    }
    if (motion) frame = raf(tick);
  };

  const start = (next: Motion) => {
    motion = next;
    if (!frame) frame = raf(tick);
  };

  return {
    cancel: stop,
    isActive: () => motion !== null,
    /** The camera the running animation is heading for, or the current one when idle. */
    target: (): Camera => {
      const camera = deps.getCamera();
      if (!motion) return camera;
      if (motion.kind === "tween") return motion.to;
      return zoomAtPoint(camera, motion.zoom, motion.sx, motion.sy);
    },
    animateTo: (target: Camera, duration = CAMERA_DURATION_MS) => {
      const size = deps.getSize();
      const camera = deps.getCamera();
      const goal = { ...target, zoom: clampZoom(target.zoom) };
      if (deps.reducedMotion() || size.width === 0 || size.height === 0) {
        stop();
        deps.apply(goal);
        return;
      }
      start({ kind: "tween", from: camera, to: goal, startedAt: now(), duration });
    },
    /** Mouse-wheel zoom: multiply the zoom target and ease the camera toward it at (sx, sy). */
    wheelZoomBy: (factor: number, sx: number, sy: number) => {
      const camera = deps.getCamera();
      const base = motion?.kind === "chase" ? motion.zoom : camera.zoom;
      const zoom = clampZoom(base * factor);
      if (deps.reducedMotion()) {
        stop();
        deps.apply(zoomAtPoint(camera, zoom, sx, sy));
        return;
      }
      start({ kind: "chase", zoom, sx, sy, last: motion?.kind === "chase" ? motion.last : now() });
    },
  };
};

export type CameraAnimator = ReturnType<typeof createCameraAnimator>;
