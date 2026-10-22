import { describe, expect, it } from "bun:test";
import googleFonts from "../../../../../apps/web/src/fonts/google-fonts.json";
import { stylePresets } from "../../styles/presets";
import { midcenturyStyles } from "./midcentury";

const fontNames = new Set((googleFonts.families as unknown[][]).map((f) => f[0] as string));
const presetIds = new Set(stylePresets.map((p) => p.name));
const INDONESIAN = /\b(gaya|ala|desain|poster|minimalis|retro|skandinavia|nordik|jepang)\b/i;

const fontFamilies = (content: string): string[] =>
  content
    .split("\n")
    .filter((line) => line.startsWith("Fonts:"))
    .flatMap((line) =>
      line
        .slice("Fonts:".length)
        .split(",")
        .map((name) => name.replace(/\(.*?\)/g, "").trim())
        .filter(Boolean),
    );

describe("midcentury style skills", () => {
  it("has the six movements", () => {
    expect(midcenturyStyles.map((s) => s.id).sort()).toEqual([
      "dieter-rams",
      "japanese-minimalism",
      "mid-century-modern",
      "polish-poster-school",
      "scandinavian",
      "swiss-international",
    ]);
  });

  it("has unique kebab-case ids", () => {
    const ids = midcenturyStyles.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  for (const skill of midcenturyStyles) {
    describe(skill.id, () => {
      it("is a style skill with metadata", () => {
        expect(skill.category).toBe("style");
        expect(skill.title.length).toBeGreaterThan(3);
        expect(skill.description.length).toBeGreaterThan(20);
        expect(skill.keywords.length).toBeGreaterThanOrEqual(10);
      });

      it("keeps content size within bounds", () => {
        expect(skill.content.length).toBeGreaterThanOrEqual(2500);
        expect(skill.content.length).toBeLessThanOrEqual(4600);
      });

      it("has 6-8 checklist items", () => {
        expect(skill.checklist.length).toBeGreaterThanOrEqual(6);
        expect(skill.checklist.length).toBeLessThanOrEqual(8);
      });

      it("uses 1-3 known preset ids", () => {
        expect(skill.styles.length).toBeGreaterThanOrEqual(1);
        expect(skill.styles.length).toBeLessThanOrEqual(3);
        for (const id of skill.styles) expect(presetIds.has(id)).toBe(true);
      });

      it("lists only fonts that exist in google-fonts.json", () => {
        const families = fontFamilies(skill.content);
        expect(families.length).toBeGreaterThanOrEqual(3);
        for (const family of families) expect(fontNames.has(family)).toBe(true);
      });

      it("has an Indonesian keyword", () => {
        expect(skill.keywords.some((k) => INDONESIAN.test(k))).toBe(true);
      });
    });
  }
});
