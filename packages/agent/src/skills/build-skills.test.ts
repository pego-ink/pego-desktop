import { describe, expect, test } from "bun:test";
import { buildSkills } from "./build-skills";

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
const INDONESIAN = /\b(halaman|website|aplikasi|situs|profil|tampilan|panel|desain|layar)\b/i;
const BANNED_RECOMMENDED = /(use|add) lorem ipsum|label (it )?"get started"/i;

describe("build skills", () => {
  test("exports the four skills with unique kebab-case ids", () => {
    const ids = buildSkills.map((skill) => skill.id);
    expect([...ids].sort()).toEqual(["landing-page", "marketing-site", "mobile-app", "web-app"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  for (const skill of buildSkills) {
    describe(skill.id, () => {
      test("content size within bounds", () => {
        const bytes = new TextEncoder().encode(skill.content).length;
        expect(bytes).toBeGreaterThanOrEqual(1500);
        expect(bytes).toBeLessThanOrEqual(5000);
      });
      test("checklist has 6-10 items", () => {
        expect(skill.checklist.length).toBeGreaterThanOrEqual(6);
        expect(skill.checklist.length).toBeLessThanOrEqual(10);
      });
      test("styles are 3-5 known ids", () => {
        expect(skill.styles.length).toBeGreaterThanOrEqual(3);
        expect(skill.styles.length).toBeLessThanOrEqual(5);
        for (const style of skill.styles) expect(STYLE_IDS).toContain(style);
      });
      test("keywords include an Indonesian phrase", () => {
        expect(skill.keywords.some((keyword) => INDONESIAN.test(keyword))).toBe(true);
      });
      test("no em dashes or recommended slop phrases", () => {
        const text = `${skill.content}\n${skill.checklist.join("\n")}`;
        expect(text).not.toContain("—");
        expect(text).not.toMatch(BANNED_RECOMMENDED);
      });
    });
  }
});
