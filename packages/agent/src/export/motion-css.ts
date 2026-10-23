import {
  DEFAULT_ANIMATION_DURATION,
  EASING_CURVES,
  SLIDE_DISTANCE,
  easingOf,
  type Animation,
  type AnimationPreset,
} from "@pego/doc";
import type { Attr, Decl } from "./ir";

// Entrances as CSS. The keyframes animate the individual `translate` / `scale` properties so they
// compose with the node's own `transform` (rotation, flips), and use the canvas' numbers
// (`motionFrame` in @pego/doc) so an export plays like the preview.

/** `@keyframes` name of a preset. */
export const keyframesName = (preset: AnimationPreset): string =>
  `pego-${preset.replace(/_/g, "-")}`;

const FROM: Record<Exclude<AnimationPreset, "none">, string> = {
  fade: "opacity: 0;",
  slide_up: `opacity: 0;\n    translate: 0 ${SLIDE_DISTANCE}px;`,
  slide_down: `opacity: 0;\n    translate: 0 -${SLIDE_DISTANCE}px;`,
  slide_left: `opacity: 0;\n    translate: ${SLIDE_DISTANCE}px 0;`,
  slide_right: `opacity: 0;\n    translate: -${SLIDE_DISTANCE}px 0;`,
  grow_up: "scale: 1 0;",
  grow_right: "scale: 0 1;",
  scale: "opacity: 0;\n    scale: 0.85;",
  pop: "opacity: 0;\n    scale: 0.5;",
};

const bezier = (animation: Animation): string =>
  `cubic-bezier(${EASING_CURVES[easingOf(animation)].join(", ")})`;

/**
 * The `animation` declaration of a node (plus its scale origin for the bar presets), or nothing for
 * `none`. `rotated` keeps the node's own top-left origin, which its rotation needs.
 */
export const motionDecls = (animation: Animation, rotated: boolean): Decl[] => {
  if (animation.preset === "none") return [];
  const duration = animation.duration ?? DEFAULT_ANIMATION_DURATION;
  const delay = animation.delay ?? 0;
  const decls: Decl[] = [
    [
      "animation",
      `${keyframesName(animation.preset)} ${duration}ms ${bezier(animation)} ${delay}ms both`,
    ],
  ];
  if (!rotated && animation.preset === "grow_up") decls.push(["transform-origin", "bottom"]);
  if (!rotated && animation.preset === "grow_right") decls.push(["transform-origin", "left"]);
  return decls;
};

/** `data-count-up="delay duration x1 y1 x2 y2"`, read by `COUNT_UP_SCRIPT`. */
export const countUpAttr = (animation: Animation): Attr => [
  "data-count-up",
  [
    animation.delay ?? 0,
    animation.duration ?? DEFAULT_ANIMATION_DURATION,
    ...EASING_CURVES[easingOf(animation)],
  ].join(" "),
];

/** The keyframes for every preset used, plus a reduced-motion opt-out; "" when none is used. */
export const motionStylesheet = (presets: ReadonlySet<AnimationPreset>): string => {
  const used = [...presets].filter((p): p is Exclude<AnimationPreset, "none"> => p !== "none");
  if (used.length === 0) return "";
  const blocks = used
    .sort()
    .map(
      (preset) => `@keyframes ${keyframesName(preset)} {\n  from {\n    ${FROM[preset]}\n  }\n}`,
    );
  return [
    ...blocks,
    "@media (prefers-reduced-motion: reduce) {\n  * {\n    animation: none !important;\n  }\n}",
  ].join("\n\n");
};

/**
 * Counts every number in `[data-count-up]` texts up from 0 with the node's timing, like the
 * canvas preview (decimals, decimal mark and leading zeros kept).
 */
export const COUNT_UP_SCRIPT = `<script>
  (() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const curve = (x1, y1, x2, y2, t) => {
      const at = (u, a, b) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
      let lo = 0, hi = 1, u = t;
      for (let i = 0; i < 30; i++) {
        if (at(u, x1, x2) < t) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
      return at(u, y1, y2);
    };
    const scaled = (text, p) =>
      text.replace(/\\d+(?:[.,]\\d+)?/g, (m) => {
        const mark = (/[.,]/.exec(m) || [])[0];
        const whole = mark ? m.indexOf(mark) : m.length;
        const decimals = mark ? m.length - whole - 1 : 0;
        let out = (Number(mark ? m.replace(mark, ".") : m) * p).toFixed(decimals);
        if (m[0] === "0" && whole > 1) {
          const [int, frac] = out.split(".");
          out = int.padStart(whole, "0") + (frac === undefined ? "" : "." + frac);
        }
        return mark ? out.replace(".", mark) : out;
      });
    for (const el of document.querySelectorAll("[data-count-up]")) {
      const [delay, duration, x1, y1, x2, y2] = el.dataset.countUp.split(" ").map(Number);
      const final = el.textContent;
      const start = performance.now() + delay;
      const tick = (now) => {
        const t = Math.min(1, Math.max(0, (now - start) / duration));
        el.textContent = t >= 1 ? final : scaled(final, Math.min(1, Math.max(0, curve(x1, y1, x2, y2, t))));
        if (t < 1) requestAnimationFrame(tick);
      };
      el.textContent = scaled(final, 0);
      requestAnimationFrame(tick);
    }
  })();
</script>`;
