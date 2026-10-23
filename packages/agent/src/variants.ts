/**
 * Variants: one request made by several agents at once, each in its own chat, each asked for a
 * distinct take so the user can compare them side by side and keep the best.
 */

import { MAX_CONCURRENT_RUNS } from "./bridge-protocol";
import type { PromptPart } from "./mentions";

export type VariantMode = "any" | "style" | "layout";

/** Most variants one prompt can ask for: one agent per run slot, so none has to wait. */
export const MAX_VARIANTS = MAX_CONCURRENT_RUNS;

/** The variant count to use: a whole number from 1 to MAX_VARIANTS. */
export const clampVariants = (count: number): number =>
  Number.isFinite(count) ? Math.min(MAX_VARIANTS, Math.max(1, Math.floor(count))) : 1;

/**
 * Variants build new frames beside each other, so they do not fit a prompt that edits layers in
 * place: one that mentions layers (a chip, or the live selection chip) runs as a single take.
 */
export const variantsFit = (parts: readonly PromptPart[]): boolean =>
  !parts.some((part) => part.kind === "mention" && part.mention === "layer");

export type VariantSubmit = "started" | "queued" | "refused";

/**
 * Submit variants 1..count. Variant 1 goes first: when it is refused nothing else is submitted
 * (so no stray chats are made and a resend does not duplicate). `submit` creates the chat for
 * index 2 and up itself. Returns variant 1's result.
 */
export const submitVariants = (
  count: number,
  submit: (index: number) => VariantSubmit,
): VariantSubmit => {
  const first = submit(1);
  if (first === "refused") return first;
  for (let index = 2; index <= clampVariants(count); index++) submit(index);
  return first;
};

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
