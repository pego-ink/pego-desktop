import { describe, expect, it } from "bun:test";
import googleFonts from "../../../../../apps/web/src/fonts/google-fonts.json";
import { digitalStyles } from "./digital";

const PRESET_IDS = [
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
const INDONESIAN = ["gaya", "desain", "tampilan", "tata letak", "kotak", "kartu", "efek", "tombol"];
const FONT_FAMILIES = new Set(googleFonts.families.map((f) => String(f[0])));
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("digitalStyles", () => {
  it("has the nine expected styles", () => {
    expect(digitalStyles.map((s) => s.id).sort()).toEqual(
      [
        "bento-grid",
        "brutalist-web",
        "editorial-magazine",
        "flat-design",
        "glassmorphism",
        "material-design",
        "neo-brutalism",
        "neumorphism",
        "skeuomorphism",
      ].sort(),
    );
  });

  it("has unique kebab-case ids and category style", () => {
    const ids = digitalStyles.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const skill of digitalStyles) {
      expect(skill.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(skill.category).toBe("style");
    }
  });

  it("keeps content within size bounds", () => {
    for (const skill of digitalStyles) {
      const size = bytes(skill.content);
      expect(size).toBeGreaterThanOrEqual(2500);
      expect(size).toBeLessThanOrEqual(4800);
    }
  });

  it("has 6 to 8 checklist items", () => {
    for (const skill of digitalStyles) {
      expect(skill.checklist.length).toBeGreaterThanOrEqual(6);
      expect(skill.checklist.length).toBeLessThanOrEqual(8);
    }
  });

  it("uses 1 to 3 known preset ids", () => {
    for (const skill of digitalStyles) {
      expect(skill.styles.length).toBeGreaterThanOrEqual(1);
      expect(skill.styles.length).toBeLessThanOrEqual(3);
      for (const style of skill.styles) expect(PRESET_IDS).toContain(style);
    }
  });

  it("lists only existing Google fonts on the Fonts line", () => {
    for (const skill of digitalStyles) {
      const lines = skill.content.split("\n").filter((l) => l.startsWith("Fonts:"));
      expect(lines.length).toBe(1);
      const families = lines[0]!
        .slice("Fonts:".length)
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      expect(families.length).toBeGreaterThan(0);
      for (const family of families) expect(FONT_FAMILIES.has(family)).toBe(true);
    }
  });

  it("has an Indonesian keyword and no em dashes", () => {
    for (const skill of digitalStyles) {
      const hit = skill.keywords.some((k) => INDONESIAN.some((id) => k.toLowerCase().includes(id)));
      expect(hit).toBe(true);
      expect(skill.content.includes("—")).toBe(false);
      expect(skill.description.includes("—")).toBe(false);
    }
  });
});
