import { describe, expect, test } from "bun:test";
import { variantNote, variantPrompt } from "./variants";

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
});
