/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Skill } from "@pego/agent";
import {
  filterStyles,
  groupStyles,
  pickableSkills,
  pickableStyles,
  skillChipView,
  styleGroupOf,
} from "./skill-chip";

const make = (
  id: string,
  title: string,
  keywords: string[],
  extra: Partial<Skill> = {},
): Skill => ({
  id,
  title,
  description: title,
  keywords,
  content: "",
  checklist: [],
  styles: [],
  ...extra,
});

const pool = [
  make("core", "Core", [], { core: true }),
  make("landing-page", "Landing page", ["landing page"]),
  make("dashboard", "Dashboard", ["dashboard"]),
  make("bauhaus", "Bauhaus", [], { category: "style" }),
  make("memphis", "Memphis", [], { category: "style" }),
  make("swiss-international", "Swiss International", [], { category: "style" }),
  make("mystery", "Mystery", [], { category: "style" }),
];

const texts = (view: ReturnType<typeof skillChipView>) =>
  view.parts.map((p) => `${p.text}${p.muted ? "~" : ""}`);

describe("skillChipView", () => {
  test("auto shows both detected parts, muted", () => {
    const view = skillChipView("landing page kopi gaya bauhaus", undefined, undefined, pool);
    expect(view.design).toMatchObject({ mode: "auto", skill: pool[1] });
    expect(view.style).toMatchObject({ mode: "auto", skill: pool[3] });
    expect(texts(view)).toEqual(["Landing page~", "Bauhaus~"]);
    expect(view.label).toBe("Landing page · Bauhaus");
  });

  test("no style detected hides the style part; no design shows a neutral label", () => {
    expect(texts(skillChipView("landing page", undefined, undefined, pool))).toEqual([
      "Landing page~",
    ]);
    expect(texts(skillChipView("hello", undefined, undefined, pool))).toEqual(["Skill~"]);
  });

  test("manual picks are not muted and win over the prompt", () => {
    const view = skillChipView("landing page bauhaus", "dashboard", "memphis", pool);
    expect(view.design.mode).toBe("manual");
    expect(view.style.mode).toBe("manual");
    expect(texts(view)).toEqual(["Dashboard", "Memphis"]);
  });

  test("null means none: core only, no style part", () => {
    const view = skillChipView("landing page bauhaus", null, null, pool);
    expect(view.design.mode).toBe("none");
    expect(view.style).toMatchObject({ mode: "none", skill: undefined });
    expect(texts(view)).toEqual(["Core only~"]);
  });

  test("a design pick with auto style, and vice versa", () => {
    expect(texts(skillChipView("bauhaus", "dashboard", undefined, pool))).toEqual([
      "Dashboard",
      "Bauhaus~",
    ]);
    expect(texts(skillChipView("landing page", undefined, "memphis", pool))).toEqual([
      "Landing page~",
      "Memphis",
    ]);
  });

  test("unknown or wrong-category ids fall back to auto", () => {
    expect(skillChipView("dashboard", "gone", undefined, pool).design.mode).toBe("auto");
    expect(skillChipView("dashboard", "bauhaus", undefined, pool).design.mode).toBe("auto");
    expect(skillChipView("bauhaus", undefined, "dashboard", pool).style.mode).toBe("auto");
  });
});

describe("pickers", () => {
  test("design list hides core and styles; style list holds only styles", () => {
    expect(pickableSkills(pool).map((s) => s.id)).toEqual(["landing-page", "dashboard"]);
    expect(pickableStyles(pool).map((s) => s.id)).toEqual([
      "bauhaus",
      "memphis",
      "swiss-international",
      "mystery",
    ]);
  });

  test("styleGroupOf and groupStyles order by era; unknown ids go to More", () => {
    expect(styleGroupOf("bauhaus")).toBe("Modernism");
    expect(styleGroupOf("swiss-international")).toBe("Mid-century");
    expect(styleGroupOf("memphis")).toBe("Postmodern & expressive");
    expect(styleGroupOf("glassmorphism")).toBe("Digital");
    expect(styleGroupOf("neo-brutalism")).toBe("Digital");
    expect(styleGroupOf("mystery")).toBe("More");
    expect(
      groupStyles(pickableStyles(pool)).map((g) => [g.group, g.skills.map((s) => s.id)]),
    ).toEqual([
      ["Modernism", ["bauhaus"]],
      ["Mid-century", ["swiss-international"]],
      ["Postmodern & expressive", ["memphis"]],
      ["More", ["mystery"]],
    ]);
  });

  test("filterStyles matches title or spaced id, ignoring case and diacritics", () => {
    const styles = pickableStyles(pool);
    expect(filterStyles(styles, "").length).toBe(4);
    expect(filterStyles(styles, "  BAU ").map((s) => s.id)).toEqual(["bauhaus"]);
    expect(filterStyles(styles, "swiss inter").map((s) => s.id)).toEqual(["swiss-international"]);
    expect(filterStyles(styles, "mémphis").map((s) => s.id)).toEqual(["memphis"]);
    expect(filterStyles(styles, "zzz")).toEqual([]);
  });
});

describe("built-in registry", () => {
  test("every shipped style belongs to a real era group", async () => {
    const { skills } = await import("@pego/agent");
    const styles = pickableStyles(skills);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.filter((s) => styleGroupOf(s.id) === "More").map((s) => s.id)).toEqual([]);
  });
});
