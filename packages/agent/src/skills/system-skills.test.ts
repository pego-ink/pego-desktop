import { describe, expect, it } from "bun:test";
import { systemSkills } from "./system-skills";

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
const INDONESIAN = [
  "halaman",
  "dasbor",
  "tabel",
  "laporan",
  "grafik",
  "statistik",
  "presentasi",
  "slide",
  "sistem desain",
  "komponen",
  "pustaka",
  "panduan",
  "media sosial",
  "sosmed",
  "postingan",
  "identitas",
  "merek",
  "desain logo",
];
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("systemSkills", () => {
  it("has unique kebab-case ids", () => {
    const ids = systemSkills.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has exactly one core skill with no styles or keywords", () => {
    const core = systemSkills.filter((skill) => skill.core);
    expect(core).toHaveLength(1);
    expect(core[0]?.styles).toEqual([]);
    expect(core[0]?.keywords).toEqual([]);
  });

  it("keeps content within size bounds", () => {
    for (const skill of systemSkills) {
      const size = bytes(skill.content);
      const [min, max] = skill.core ? [2000, 3300] : [1500, 4300];
      expect(size).toBeGreaterThanOrEqual(min);
      expect(size).toBeLessThanOrEqual(max);
    }
  });

  it("has 6 to 10 checklist items", () => {
    for (const skill of systemSkills) {
      expect(skill.checklist.length).toBeGreaterThanOrEqual(6);
      expect(skill.checklist.length).toBeLessThanOrEqual(10);
    }
  });

  it("uses only known style ids, 3 to 5 for non-core", () => {
    for (const skill of systemSkills.filter((s) => !s.core)) {
      expect(skill.styles.length).toBeGreaterThanOrEqual(3);
      expect(skill.styles.length).toBeLessThanOrEqual(5);
    }
    for (const skill of systemSkills) {
      for (const style of skill.styles) expect(STYLE_IDS).toContain(style);
    }
  });

  it("has an Indonesian keyword for every non-core skill", () => {
    for (const skill of systemSkills.filter((s) => !s.core)) {
      const hit = skill.keywords.some((k) => INDONESIAN.some((id) => k.toLowerCase().includes(id)));
      expect(hit).toBe(true);
    }
  });

  it("contains no em dashes", () => {
    for (const skill of systemSkills) {
      expect(skill.content.includes("—")).toBe(false);
    }
  });
});
