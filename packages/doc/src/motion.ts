import { resolveInstance } from "./instance";
import { MAX_INSTANCE_DEPTH } from "./layout";
import type { Animation, AnimationEasing, AnimationPreset, PegoDocument, PegoNode } from "./schema";

/**
 * Motion: a node's `animation` is an entrance (from a start state to the node as designed), played
 * from time 0 in the canvas preview and in exported code. The canvas and the exporters share these
 * numbers so a played design looks the same in both.
 */

export const DEFAULT_ANIMATION_DURATION = 600;
/** How far the slide presets travel, in px. */
export const SLIDE_DISTANCE = 24;

/** CSS `cubic-bezier()` control points of each easing. */
export const EASING_CURVES: Record<AnimationEasing, readonly [number, number, number, number]> = {
  ease_out: [0.22, 1, 0.36, 1],
  ease_in_out: [0.65, 0, 0.35, 1],
  linear: [0, 0, 1, 1],
  spring: [0.34, 1.56, 0.64, 1],
};

/** The easing an animation uses: its own, else `spring` for `pop` and `ease_out` for the rest. */
export const easingOf = (animation: Animation): AnimationEasing =>
  animation.easing ?? (animation.preset === "pop" ? "spring" : "ease_out");

/** Evaluate a CSS cubic-bezier timing function at `t` (0..1), like a browser does. */
export const cubicBezier = (
  curve: readonly [number, number, number, number],
  t: number,
): number => {
  const [x1, y1, x2, y2] = curve;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (x1 === y1 && x2 === y2) return t;
  const bezier = (u: number, p1: number, p2: number) =>
    3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u;
  const slope = (u: number, p1: number, p2: number) =>
    3 * (1 - u) * (1 - u) * p1 + 6 * (1 - u) * u * (p2 - p1) + 3 * u * u * (1 - p2);
  // Newton's method on x(u) = t, then bisection if it did not settle.
  let u = t;
  for (let i = 0; i < 8; i++) {
    const error = bezier(u, x1, x2) - t;
    if (Math.abs(error) < 1e-6) return bezier(u, y1, y2);
    const d = slope(u, x1, x2);
    if (Math.abs(d) < 1e-6) break;
    u -= error / d;
  }
  let lo = 0;
  let hi = 1;
  u = t;
  for (let i = 0; i < 40; i++) {
    const x = bezier(u, x1, x2);
    if (Math.abs(x - t) < 1e-6) break;
    if (x < t) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  return bezier(u, y1, y2);
};

/** What the entrance does to the node at one moment. Translation is in px, scale about `origin`. */
export type MotionFrame = {
  /** Multiplies the node's own opacity. */
  opacity: number;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  /** Scale origin as a fraction of the box (0 = left / top, 1 = right / bottom). */
  originX: number;
  originY: number;
  /** Eased progress clamped to 0..1, for counting numbers up. */
  progress: number;
};

export const REST_FRAME: MotionFrame = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scaleX: 1,
  scaleY: 1,
  originX: 0.5,
  originY: 0.5,
  progress: 1,
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The start state of each preset, given eased progress `e` (1 = as designed). */
const presetFrame = (preset: AnimationPreset, e: number): Partial<MotionFrame> => {
  const fade = clamp01(e);
  const away = (1 - e) * SLIDE_DISTANCE;
  switch (preset) {
    case "none":
      return {};
    case "fade":
      return { opacity: fade };
    case "slide_up":
      return { opacity: fade, dy: away };
    case "slide_down":
      return { opacity: fade, dy: -away };
    case "slide_left":
      return { opacity: fade, dx: away };
    case "slide_right":
      return { opacity: fade, dx: -away };
    case "grow_up":
      return { scaleY: Math.max(0, e), originY: 1 };
    case "grow_right":
      return { scaleX: Math.max(0, e), originX: 0 };
    case "scale": {
      const s = 0.85 + 0.15 * e;
      return { opacity: fade, scaleX: s, scaleY: s };
    }
    case "pop": {
      const s = Math.max(0, 0.5 + 0.5 * e);
      return { opacity: fade, scaleX: s, scaleY: s };
    }
  }
};

/** The node's entrance at `time` ms after playback started. */
export const motionFrame = (animation: Animation, time: number): MotionFrame => {
  const duration = animation.duration ?? DEFAULT_ANIMATION_DURATION;
  const t = clamp01((time - (animation.delay ?? 0)) / duration);
  if (t >= 1) return REST_FRAME;
  const e = cubicBezier(EASING_CURVES[easingOf(animation)], t);
  return { ...REST_FRAME, ...presetFrame(animation.preset, e), progress: clamp01(e) };
};

const NUMBER = /\d+(?:[.,]\d+)?/g;

/**
 * `content` with every number scaled by `progress` (0..1), keeping its decimals, decimal mark and
 * leading zeros: "70%" at 0.5 is "35%", "1,2 kg" is "0,6 kg", "05" is "03".
 */
export const countUpText = (content: string, progress: number): string => {
  if (progress >= 1) return content;
  const p = Math.max(0, progress);
  return content.replace(NUMBER, (match) => {
    const mark = /[.,]/.exec(match)?.[0];
    const whole = mark ? match.indexOf(mark) : match.length;
    const decimals = mark ? match.length - whole - 1 : 0;
    const value = Number(mark ? match.replace(mark, ".") : match);
    let text = (value * p).toFixed(decimals);
    if (match.startsWith("0") && whole > 1) {
      const [int = "", frac] = text.split(".");
      text = int.padStart(whole, "0") + (frac === undefined ? "" : `.${frac}`);
    }
    return mark ? text.replace(".", mark) : text;
  });
};

/** When the last entrance in `nodes` (and below, instances included) ends, in ms; 0 for none. */
export const motionEnd = (doc: PegoDocument, nodes: readonly PegoNode[]): number => {
  let end = 0;
  const walk = (list: readonly PegoNode[], depth: number) => {
    for (const raw of list) {
      const node =
        raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
      if (!node || node.visible === false) continue;
      if (node.type !== "page" && node.animation) {
        const { delay = 0, duration = DEFAULT_ANIMATION_DURATION } = node.animation;
        end = Math.max(end, delay + duration);
      }
      if ("children" in node) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return end;
};
