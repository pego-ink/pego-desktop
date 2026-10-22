import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { skills, type Skill } from "./skills/index";
import { toolByName } from "./tools";
import { createFakeHost } from "./test-host";

const fakeStyle: Skill = {
  id: "zz-style",
  title: "ZZ style",
  description: "A fake style",
  keywords: [],
  content: "x",
  checklist: [],
  styles: [],
  category: "style",
};

beforeEach(() => void skills.push(fakeStyle));
afterEach(() => void skills.splice(skills.indexOf(fakeStyle), 1));

const listSkills = async (input: unknown) => {
  const tool = toolByName("list_skills");
  if (!tool) throw new Error("no list_skills");
  const result = await tool.run(input, createFakeHost());
  return JSON.parse(result.content) as { skills: { id: string; category: string }[] };
};

describe("list_skills", () => {
  test("lists everything with a category by default", async () => {
    const { skills: all } = await listSkills({});
    expect(all.find((s) => s.id === "zz-style")?.category).toBe("style");
    expect(all.some((s) => s.category === "design")).toBe(true);
    expect(all.some((s) => s.category === "core")).toBe(true);
  });

  test("category filter keeps only that category", async () => {
    const styles = (await listSkills({ category: "style" })).skills;
    expect(styles.map((s) => s.id)).toContain("zz-style");
    expect(styles.every((s) => s.category === "style")).toBe(true);
    const designs = (await listSkills({ category: "design" })).skills;
    expect(designs.some((s) => s.id === "zz-style" || s.category === "core")).toBe(false);
    expect(designs.length).toBeGreaterThan(0);
  });

  test("rejects an unknown category", async () => {
    const tool = toolByName("list_skills");
    const result = await tool?.run({ category: "nope" }, createFakeHost());
    expect(result?.isError).toBe(true);
  });
});
