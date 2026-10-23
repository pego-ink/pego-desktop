import type { Animation, AnimationPreset, PegoNode, UpdateOp } from "@pego/doc";

/** Delay between siblings when they enter one by one, in ms. */
export const STAGGER_STEP = 150;

/**
 * Update ops that give every visible child of `parent` the same entrance, one after another: the
 * first starts at `start` ms, each next one `step` ms later. A child keeps its own duration and
 * easing when it already has an animation.
 */
export const staggerChildrenOps = (
  parent: PegoNode,
  preset: AnimationPreset,
  start = 0,
  step = STAGGER_STEP,
): UpdateOp[] => {
  if (!("children" in parent)) return [];
  return parent.children
    .filter((child) => child.visible !== false)
    .map((child, index): UpdateOp => {
      const own = child.type === "page" ? undefined : child.animation;
      const animation: Animation = { ...own, preset, delay: start + index * step };
      return { op: "update", id: child.id, props: { animation } };
    });
};
