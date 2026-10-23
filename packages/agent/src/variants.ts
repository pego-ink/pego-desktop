/**
 * Variants: one request made by several agents at once, each in its own chat, each asked for a
 * distinct take so the user can compare them side by side and keep the best.
 */

export type VariantMode = "any" | "style" | "layout";

/** Most variants one prompt can ask for. */
export const MAX_VARIANTS = 4;

const MODE_TEXT: Record<VariantMode, string> = {
  any: "Make it clearly different from what the others are likely to make (layout, style or both).",
  style:
    "Keep a sensible layout but give it its own visual style: colors, type, shapes and imagery differ from the other variants.",
  layout:
    "Keep the style plain and consistent but explore a different layout: structure, hierarchy and arrangement differ from the other variants.",
};

/**
 * What one agent of a variant run gets after the request: which variant it is and how to stay
 * out of the other agents' way.
 */
export const variantNote = (index: number, count: number, mode: VariantMode): string =>
  [
    `Variant ${index} of ${count}: ${count} agents work on this same request at the same time, each in its own chat. ${MODE_TEXT[mode]}`,
    `Build your result as new top-level frames of your own, named with a " · Variant ${index}" suffix, placed in empty space (find_empty_space) beside the others, and leave layers made by the other variants alone. Only edit existing layers when the request is about them, and then work on a copy of your own.`,
  ].join("\n");

/** The prompt one variant's agent receives. */
export const variantPrompt = (
  agentText: string,
  index: number,
  count: number,
  mode: VariantMode,
) => (count <= 1 ? agentText : `${agentText}\n\n${variantNote(index, count, mode)}`);
