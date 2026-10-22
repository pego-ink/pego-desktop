import { describe, expect, test } from "bun:test";
import googleFonts from "../../../../../apps/web/src/fonts/google-fonts.json";
import { stylePresets } from "../../styles/presets";
import { expressiveStyles } from "./expressive";

const FONT_FAMILIES = new Set((googleFonts.families as unknown[][]).map((f) => String(f[0])));
const PRESET_IDS = new Set(stylePresets.map((p) => p.name));
const INDONESIAN = /\b(gaya|desain|tipografi|poster|estetika|tampilan|pola|zaman|retro 80an)\b/i;

describe("expressive style skills", () => {
  test("exports the six movements with unique kebab-case ids", () => {
    const ids = expressiveStyles.map((s) => s.id);
    expect(ids).toEqual([
      "memphis",
      "postmodern-new-wave",
      "grunge-typography",
      "psychedelic",
      "y2k-frutiger-aero",
      "retro-futurism-vaporwave",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  for (const skill of expressiveStyles) {
    describe(skill.id, () => {
      test("is a style skill with a size-bounded body", () => {
        expect(skill.category).toBe("style");
        const bytes = new TextEncoder().encode(skill.content).length;
        expect(bytes).toBeGreaterThanOrEqual(2500);
        expect(bytes).toBeLessThanOrEqual(4500);
        expect(skill.description.length).toBeGreaterThan(20);
      });

      test("has 6-8 checklist items", () => {
        expect(skill.checklist.length).toBeGreaterThanOrEqual(6);
        expect(skill.checklist.length).toBeLessThanOrEqual(8);
      });

      test("styles are 1-3 existing preset ids", () => {
        expect(skill.styles.length).toBeGreaterThanOrEqual(1);
        expect(skill.styles.length).toBeLessThanOrEqual(3);
        for (const id of skill.styles) expect(PRESET_IDS.has(id)).toBe(true);
      });

      test("every Fonts: family exists in google-fonts.json", () => {
        const lines = skill.content.split("\n").filter((l) => l.startsWith("Fonts:"));
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          const families = line
            .slice("Fonts:".length)
            .split(/[,;]/)
            .map((f) => f.replace(/\(.*?\)/g, "").trim())
            .filter(Boolean);
          expect(families.length).toBeGreaterThan(0);
          for (const family of families) expect(FONT_FAMILIES.has(family)).toBe(true);
        }
      });

      test("has an Indonesian keyword", () => {
        expect(skill.keywords.some((k) => INDONESIAN.test(k))).toBe(true);
      });
    });
  }
});
