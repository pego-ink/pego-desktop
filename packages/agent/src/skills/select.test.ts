/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { skillToMarkdown } from "./format";
import { stem, suggestSkills, suggestStyle } from "./select";
import type { Skill } from "./types";

const make = (
  id: string,
  title: string,
  keywords: string[],
  core = false,
  category?: Skill["category"],
): Skill => ({
  id,
  title,
  description: `${title} skill`,
  keywords,
  content: `Body of ${id}.`,
  checklist: [`check ${id}`],
  styles: [],
  ...(core ? { core: true } : {}),
  ...(category ? { category } : {}),
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
  make("bauhaus", "Bauhaus", ["bauhaus", "gaya bauhaus", "dessau"], false, "style"),
  make(
    "swiss-international",
    "Swiss International",
    ["swiss style", "gaya swiss", "ala swiss"],
    false,
    "style",
  ),
  make("dieter-rams", "Dieter Rams", ["dieter rams", "braun", "less but better"], false, "style"),
  make(
    "neo-brutalism",
    "Neo-brutalism",
    ["neo brutalism", "neubrutalism", "neo-brutalist"],
    false,
    "style",
  ),
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

describe("design and style selection", () => {
  test("suggestSkills returns design skills only", () => {
    expect(ids("landing page kopi gaya bauhaus")).toEqual(["landing-page"]);
    expect(ids("bauhaus gaya swiss", 5)).toEqual([]);
  });

  test("suggestStyle names the movement in English and Indonesian", () => {
    const style = (prompt: string) => suggestStyle(prompt, { skills: pool })?.id;
    expect(style("landing page kopi gaya bauhaus")).toBe("bauhaus");
    expect(style("dashboard ala Swiss International")).toBe("swiss-international");
    expect(style("gaya swiss untuk landing page")).toBe("swiss-international");
    expect(style("pakai dieter rams style")).toBe("dieter-rams");
    expect(style("a neubrutalism pricing page")).toBe("neo-brutalism");
    expect(style("Neo-Brutalist cards")).toBe("neo-brutalism");
  });

  test("no style without a movement name; generic keywords never pick one", () => {
    const style = (prompt: string) => suggestStyle(prompt, { skills: pool });
    expect(style("landing page kopi")).toBeUndefined();
    expect(style("minimal clean grid layout with thick borders")).toBeUndefined();
    expect(style("")).toBeUndefined();
    expect(suggestStyle("bauhaus", { skills: [pool[1] as Skill] })).toBeUndefined();
  });

  test("mixed prompt yields design plus style", () => {
    const prompt = "landing page kopi gaya bauhaus";
    expect(suggestSkills(prompt, { skills: pool, limit: 1 })[0]?.id).toBe("landing-page");
    expect(suggestStyle(prompt, { skills: pool })?.id).toBe("bauhaus");
  });
});

describe("built-in registry", () => {
  test("mixed prompts pick one design and one style", () => {
    const cases: [string, string, string | undefined][] = [
      ["landing page kopi gaya bauhaus", "landing-page", "bauhaus"],
      ["dashboard analytics ala swiss", "dashboard", "swiss-international"],
      ["landing page dieter rams style", "landing-page", "dieter-rams"],
      ["landing page neubrutalism", "landing-page", "neo-brutalism"],
      ["landing page kopi", "landing-page", undefined],
    ];
    for (const [prompt, design, style] of cases) {
      expect(suggestSkills(prompt, { limit: 1 })[0]?.id).toBe(design);
      expect(suggestStyle(prompt)?.id).toBe(style);
    }
  });
});
