import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "astro/zod";
import { entrySchema } from "@/content/schema";

const dir = join(import.meta.dir, "entries");
const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
const schema = entrySchema(() => z.string());

const frontmatter = (source: string): unknown => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return match?.[1] === undefined ? undefined : Bun.YAML.parse(match[1]);
};

describe("changelog entries", () => {
  test("there is at least one entry", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("slugs are unique and URL-safe", () => {
    const slugs = files.map((name) => name.replace(/\.md$/, ""));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  for (const name of files) {
    test(`${name} has valid frontmatter and a body`, () => {
      const source = readFileSync(join(dir, name), "utf8");
      const result = schema.safeParse(frontmatter(source));
      expect(result.success ? [] : result.error.issues).toEqual([]);
      expect(source.replace(/^---[\s\S]*?\n---/, "").trim().length).toBeGreaterThan(0);
    });
  }

  test("the schema rejects an image without alt text", () => {
    const base = { title: "T", date: "2026-10-23", summary: "S", tags: ["new"], image: "./a.png" };
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, imageAlt: "A screenshot" }).success).toBe(true);
  });

  test("the schema rejects a summary over 160 characters", () => {
    const base = { title: "T", date: "2026-10-23", summary: "x".repeat(161), tags: ["new"] };
    expect(schema.safeParse(base).success).toBe(false);
  });
});
