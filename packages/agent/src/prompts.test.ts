import { describe, expect, test } from "bun:test";
import {
  CLAUDE_CODE_SYSTEM,
  EXECUTOR_SYSTEM,
  PLANNER_SYSTEM,
  parsePlan,
  planOutputSchema,
} from "./prompts";
import { coreSkills } from "./skills/index";
import { agentTools } from "./tools";
import { animationEasingSchema, animationPresetSchema, shaderPresetSchema } from "@pego/doc";

/** Animation presets and easings and shader presets: the values the prompts name. */
const MOTION_KEYWORDS = [
  ...animationPresetSchema.options,
  ...animationEasingSchema.options,
  ...shaderPresetSchema.options,
];

describe("prompts", () => {
  test("prompts with the working rules name every core skill", () => {
    for (const prompt of [EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      expect(prompt).toContain("The core and ui-polish skills apply to every design");
      for (const skill of coreSkills()) expect(prompt).toContain(skill.id);
    }
    expect(CLAUDE_CODE_SYSTEM).toContain("get_skill for core, ui-polish and the matching skill");
  });

  test("are non-empty and free of volatile content", () => {
    for (const prompt of [PLANNER_SYSTEM, EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      expect(prompt.length).toBeGreaterThan(500);
      expect(prompt).not.toMatch(/20\d\d-\d\d-\d\d/);
    }
  });

  test("Claude Code prompt names only real tools", () => {
    // get_guidelines is a deprecated alias of the skills tools; prompts teach get_skill.
    const names = agentTools.map((t) => t.name).filter((name) => name !== "get_guidelines");
    for (const name of names) expect(CLAUDE_CODE_SYSTEM).toContain(name);
    const mentioned = [...CLAUDE_CODE_SYSTEM.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map(
      (m) => m[1],
    );
    const allowed = new Set([
      ...names,
      "fill_container",
      "fit_content",
      "space_between",
      "space_around",
      ...MOTION_KEYWORDS,
    ]);
    for (const word of mentioned) expect(allowed.has(word as string)).toBe(true);
  });
});

describe("prompts teach the workflow", () => {
  test("every prompt mentions the verify loop and placement", () => {
    for (const prompt of [PLANNER_SYSTEM, EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      for (const name of ["get_screenshot", "check_layout", "get_skill"]) {
        expect(prompt).toContain(name);
      }
    }
    for (const prompt of [EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      for (const name of ["get_selection", "batch_design", "find_empty_space", "focus_nodes"]) {
        expect(prompt).toContain(name);
      }
    }
  });

  test("every prompt carries the one-style rule", () => {
    for (const prompt of [PLANNER_SYSTEM, EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      expect(prompt).toContain("also load that style skill");
      expect(prompt).toContain("drive typography, color and composition");
      expect(prompt).toContain("never mix several movements unless asked");
    }
  });

  test("every prompt carries the match-the-user's-language rule", () => {
    for (const prompt of [PLANNER_SYSTEM, EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      expect(prompt).toContain("Detect the language of the user's request");
      expect(prompt).toContain("Tool names, node ids, variable names and code stay in English");
    }
  });

  test("prompts only name real tools or known keywords", () => {
    const names = new Set([
      ...agentTools.map((t) => t.name),
      "fill_container",
      "fit_content",
      "space_between",
      "space_around",
      ...MOTION_KEYWORDS,
    ]);
    for (const prompt of [PLANNER_SYSTEM, EXECUTOR_SYSTEM, CLAUDE_CODE_SYSTEM]) {
      const mentioned = [...prompt.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]);
      for (const word of mentioned) expect(names.has(word as string)).toBe(true);
    }
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
