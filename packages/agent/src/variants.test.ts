import { describe, expect, test } from "bun:test";
import {
  clampVariants,
  MAX_VARIANTS,
  submitVariants,
  variantNote,
  variantPrompt,
  variantsFit,
  type VariantSubmit,
} from "./variants";

describe("variants", () => {
  test("one variant is the request as it is", () => {
    expect(variantPrompt("Make a hero", 1, 1, "any")).toBe("Make a hero");
  });

  test("each agent learns its number, the kind of difference and where to build", () => {
    const text = variantPrompt("Make a hero", 2, 3, "layout");
    expect(text).toStartWith("Make a hero\n\nVariant 2 of 3:");
    expect(text).toContain("different layout");
    expect(text).toContain('" · Variant 2" suffix');
    expect(variantNote(1, 2, "style")).toContain("its own visual style");
  });

  test("the count is capped at the concurrent run limit", () => {
    expect(MAX_VARIANTS).toBe(3);
    expect(clampVariants(9)).toBe(3);
    expect(clampVariants(0)).toBe(1);
    expect(clampVariants(Number.NaN)).toBe(1);
  });

  test("a prompt that mentions layers is not a variants prompt", () => {
    const text = { kind: "text" as const, text: "make " };
    expect(variantsFit([text])).toBe(true);
    expect(variantsFit([text, { kind: "mention", mention: "component", label: "Card" }])).toBe(
      true,
    );
    expect(variantsFit([text, { kind: "mention", mention: "layer", label: "Hero" }])).toBe(false);
  });

  test("a refused first variant submits nothing else", () => {
    const calls: number[] = [];
    const result = submitVariants(3, (index) => {
      calls.push(index);
      return "refused";
    });
    expect(result).toBe("refused");
    expect(calls).toEqual([1]);
  });

  test("an accepted first variant submits the rest, at most the cap", () => {
    const calls: number[] = [];
    const run = (index: number): VariantSubmit => {
      calls.push(index);
      return index === 1 ? "queued" : "started";
    };
    expect(submitVariants(7, run)).toBe("queued");
    expect(calls).toEqual([1, 2, 3]);
  });
});
