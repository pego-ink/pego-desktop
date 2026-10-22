import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { modernismStyles } from "./modernism";

const STYLE_IDS = [
  "quiet-ink",
  "warm-editorial",
  "midnight-product",
  "terminal-green",
  "soft-bento",
  "bold-block",
  "forest-sage",
  "carbon-dense",
  "swiss-grid",
  "newsprint",
  "studio-minimal",
  "warm-craft",
  "clinical-light",
  "data-dense-dark",
  "playful-rounded",
  "architectural",
  "botanical",
  "nordic-calm",
  "high-contrast-mono",
  "sunlit-pastel",
];
const INDONESIAN =
  /\b(gaya|ala|desain|poster|tahun|ornamen|konstruktivis\w*|futurisme|neoplastisisme|propaganda|belle)\b/i;
const EXPECTED_IDS = [
  "art-deco",
  "art-nouveau",
  "bauhaus",
  "de-stijl",
  "italian-futurism",
  "russian-constructivism",
];

const fontsFile = new URL("../../../../../apps/web/src/fonts/google-fonts.json", import.meta.url);
const fontFamilies = new Set(
  (JSON.parse(readFileSync(fontsFile, "utf8")) as { families: [string][] }).families.map(
    (family) => family[0],
  ),
);

const fontsOf = (content: string): string[] =>
  content
    .split("\n")
    .flatMap((line) => {
      const match = /Fonts:\s*(.+)$/.exec(line);
      return match?.[1] ? match[1].split(",").map((name) => name.trim()) : [];
    })
    .filter(Boolean);

describe("modernism style skills", () => {
  test("exports the six movements with unique kebab-case ids", () => {
    const ids = modernismStyles.map((skill) => skill.id);
    expect([...ids].sort()).toEqual(EXPECTED_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  for (const skill of modernismStyles) {
    describe(skill.id, () => {
      test("is a style skill with metadata", () => {
        expect(skill.category).toBe("style");
        expect(skill.title.length).toBeGreaterThan(0);
        expect(skill.description.length).toBeGreaterThan(20);
        expect(skill.description).not.toContain("\n");
      });

      test("content size within bounds", () => {
        const bytes = new TextEncoder().encode(skill.content).length;
        expect(bytes).toBeGreaterThanOrEqual(2500);
        expect(bytes).toBeLessThanOrEqual(4500);
      });

      test("content has the five sections", () => {
        for (const heading of [
          "## Essence",
          "## Visual vocabulary",
          "## In Pego",
          "## Pitfalls",
          "## Pair with",
        ])
          expect(skill.content).toContain(heading);
      });

      test("checklist has 6-8 items", () => {
        expect(skill.checklist.length).toBeGreaterThanOrEqual(6);
        expect(skill.checklist.length).toBeLessThanOrEqual(8);
      });

      test("styles are 1-3 known presets", () => {
        expect(skill.styles.length).toBeGreaterThanOrEqual(1);
        expect(skill.styles.length).toBeLessThanOrEqual(3);
        for (const id of skill.styles) expect(STYLE_IDS).toContain(id);
      });

      test("every named font exists in google-fonts.json", () => {
        const fonts = fontsOf(skill.content);
        expect(fonts.length).toBeGreaterThanOrEqual(3);
        for (const name of fonts) expect(fontFamilies.has(name)).toBe(true);
      });

      test("keywords include the id and an Indonesian phrase", () => {
        expect(skill.keywords.length).toBeGreaterThanOrEqual(8);
        expect(skill.keywords.some((keyword) => INDONESIAN.test(keyword))).toBe(true);
        expect(
          skill.keywords.some(
            (keyword) =>
              keyword.toLowerCase().includes("gaya") || keyword.toLowerCase().includes("ala "),
          ),
        ).toBe(true);
      });

      test("content avoids backtick fences and defines variables", () => {
        expect(skill.content).toContain("Variables:");
        expect(skill.content).toContain("radius");
      });
    });
  }
});
