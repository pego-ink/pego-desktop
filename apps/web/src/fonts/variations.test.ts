import { describe, expect, test } from "bun:test";
import { fontVariationsFor, setVariableFamilyLookup } from "./variations";

describe("fontVariationsFor", () => {
  test("bundled Inter is always variable", () => {
    expect(fontVariationsFor("Inter", 700)).toEqual([{ axis: "wght", value: 700 }]);
  });

  test("uses the installed catalog lookup for other families", () => {
    setVariableFamilyLookup(() => false);
    expect(fontVariationsFor("Lobster", 400)).toBeUndefined();
    setVariableFamilyLookup((family) => family === "Playfair Display");
    expect(fontVariationsFor("Playfair Display", 800)).toEqual([{ axis: "wght", value: 800 }]);
    expect(fontVariationsFor("Lobster", 400)).toBeUndefined();
    setVariableFamilyLookup(() => false);
  });
});
