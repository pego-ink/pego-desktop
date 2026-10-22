/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Skill } from "@pego/agent";
import { pickableSkills, skillChipView } from "./skill-chip";

const make = (id: string, title: string, keywords: string[], core = false): Skill => ({
  id,
  title,
  description: title,
  keywords,
  content: "",
  checklist: [],
  styles: [],
  ...(core ? { core: true } : {}),
});

const pool = [
  make("core", "Core", [], true),
  make("landing-page", "Landing page", ["landing page"]),
  make("dashboard", "Dashboard", ["dashboard"]),
];

describe("skillChipView", () => {
  test("auto shows the detected skill with an auto suffix", () => {
    expect(skillChipView("buatkan landing page untuk kopi", undefined, pool)).toEqual({
      mode: "auto",
      skill: pool[1],
      label: "Landing page",
      suffix: "auto",
    });
  });

  test("auto with no match shows a neutral label", () => {
    const view = skillChipView("hello", undefined, pool);
    expect(view).toMatchObject({ mode: "auto", skill: undefined, label: "Skill" });
  });

  test("a manual pick wins over the prompt; null means core only", () => {
    expect(skillChipView("landing page", "dashboard", pool)).toMatchObject({
      mode: "manual",
      label: "Dashboard",
      suffix: null,
    });
    expect(skillChipView("landing page", null, pool)).toMatchObject({
      mode: "none",
      label: "Core only",
    });
  });

  test("an unknown manual id falls back to auto", () => {
    expect(skillChipView("dashboard", "gone", pool).mode).toBe("auto");
  });

  test("pickableSkills hides core", () => {
    expect(pickableSkills(pool).map((s) => s.id)).toEqual(["landing-page", "dashboard"]);
  });
});
