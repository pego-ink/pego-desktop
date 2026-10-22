import { describe, expect, test } from "bun:test";
import {
  CLAUDE_CODE_SYSTEM,
  EXECUTOR_SYSTEM,
  PLANNER_SYSTEM,
  parsePlan,
  planOutputSchema,
} from "./prompts";
import { agentTools } from "./tools";

describe("prompts", () => {
  test("are non-empty and free of volatile content", () => {
    for (const prompt of [PLANNER_SYSTEM, EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      expect(prompt.length).toBeGreaterThan(500);
      expect(prompt).not.toMatch(/20\d\d-\d\d-\d\d/);
    }
  });

  test("Claude Code prompt names only real tools", () => {
    const names = agentTools.map((t) => t.name);
    for (const name of names) expect(CLAUDE_CODE_SYSTEM).toContain(name);
    const mentioned = [...CLAUDE_CODE_SYSTEM.matchAll(/\b([a-z]+_[a-z]+)\b/g)].map((m) => m[1]);
    const allowed = new Set([
      ...names,
      "fill_container",
      "fit_content",
      "space_between",
      "space_around",
    ]);
    for (const word of mentioned) expect(allowed.has(word as string)).toBe(true);
  });
});

describe("plan schema and parsePlan", () => {
  test("planOutputSchema is a strict object schema", () => {
    expect(planOutputSchema.type).toBe("object");
    expect(planOutputSchema.additionalProperties).toBe(false);
    expect(planOutputSchema.required).toEqual(["steps"]);
  });

  test("parses valid output and drops empty detail", () => {
    const steps = parsePlan({
      steps: [
        { id: "s1", title: " Variables ", detail: "Add $accent" },
        { id: "s2", title: "Layout", detail: "  " },
      ],
    });
    expect(steps).toEqual([
      { id: "s1", title: "Variables", detail: "Add $accent" },
      { id: "s2", title: "Layout" },
    ]);
  });

  test("rejects malformed plans", () => {
    expect(() => parsePlan(null)).toThrow();
    expect(() => parsePlan({ steps: [] })).toThrow();
    expect(() => parsePlan({ steps: [{ id: "", title: "x", detail: "" }] })).toThrow();
    expect(() => parsePlan({ steps: [{ id: "a", title: "x" }] })).toThrow();
    expect(() =>
      parsePlan({
        steps: [
          { id: "a", title: "x", detail: "" },
          { id: "a", title: "y", detail: "" },
        ],
      }),
    ).toThrow("unique");
  });
});
