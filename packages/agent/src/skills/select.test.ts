/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { skillToMarkdown } from "./format";
import { stem, suggestSkills } from "./select";
import type { Skill } from "./types";

const make = (id: string, title: string, keywords: string[], core = false): Skill => ({
  id,
  title,
  description: `${title} skill`,
  keywords,
  content: `Body of ${id}.`,
  checklist: [`check ${id}`],
  styles: [],
  ...(core ? { core: true } : {}),
});

const pool = [
  make("core", "Core", ["design"], true),
  make("landing-page", "Landing page", [
    "landing page",
    "landing",
    "halaman utama",
    "homepage",
    "kedai",
  ]),
  make("web-app", "Web app", ["web app", "aplikasi web", "saas", "app"]),
  make("mobile-app", "Mobile app", [
    "mobile app",
    "aplikasi mobile",
    "onboarding",
    "ios",
    "android",
    "app",
  ]),
  make("dashboard", "Dashboard", ["dashboard", "admin", "chart", "grafik", "analytics"]),
  make("slides", "Slides", ["slide", "presentation", "presentasi", "pitch deck", "deck"]),
  make("brand-identity", "Brand identity", ["logo", "brand", "identitas merek", "brand identity"]),
];

const ids = (prompt: string, limit?: number) =>
  suggestSkills(prompt, { skills: pool, ...(limit ? { limit } : {}) }).map((s) => s.id);

describe("stem", () => {
  test("plural and suffix handling", () => {
    expect(stem("dashboards")).toBe("dashboard");
    expect(stem("categories")).toBe("category");
    expect(stem("boxes")).toBe("box");
    expect(stem("class")).toBe("class");
    expect(stem("kopinya")).toBe("kopi");
  });
});

describe("suggestSkills", () => {
  test("realistic prompts in Indonesian and English", () => {
    expect(ids("buatkan landing page untuk kopi")[0]).toBe("landing-page");
    expect(ids("Design an admin dashboard with charts")[0]).toBe("dashboard");
    expect(ids("bikin logo")[0]).toBe("brand-identity");
    expect(ids("presentasi pitch deck 10 slide")[0]).toBe("slides");
    expect(ids("mobile app onboarding")[0]).toBe("mobile-app");
    expect(ids("buat aplikasi web untuk kasir")[0]).toBe("web-app");
  });

  test("case, diacritics, punctuation and plurals", () => {
    expect(ids("DASHBOARDS!")[0]).toBe("dashboard");
    expect(ids("Landing-Page for café")[0]).toBe("landing-page");
    expect(ids("grafiknya")[0]).toBe("dashboard");
  });

  test("matches whole words only", () => {
    expect(ids("a happy snapshot")).toEqual([]);
    expect(ids("catalogue of apparel")).toEqual([]);
  });

  test("phrases outrank bare words and respect limit", () => {
    expect(ids("mobile app")).toEqual(["mobile-app", "web-app"]);
    expect(ids("mobile app", 1)).toEqual(["mobile-app"]);
  });

  test("never returns core skills; empty when nothing matches", () => {
    expect(ids("design")).toEqual([]);
    expect(ids("")).toEqual([]);
    expect(ids("what is the weather")).toEqual([]);
    expect(suggestSkills("x", { skills: [], limit: 2 })).toEqual([]);
  });
});

describe("skillToMarkdown", () => {
  test("includes body, checklist and styles", () => {
    const md = skillToMarkdown({ ...make("a", "A", []), styles: ["calm"] });
    expect(md).toContain("# A");
    expect(md).toContain("Body of a.");
    expect(md).toContain("- check a");
    expect(md).toContain("calm");
  });
});
