/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { agentTools } from "@pego/agent";
import { MAGIC_ACTIONS, magicDisplay, magicPrompt } from "./pego-magic";

describe("Pego Magic", () => {
  test("six ideas with unique ids, in pen.dev's order", () => {
    expect(MAGIC_ACTIONS.map((a) => a.id)).toEqual([
      "layout",
      "style",
      "color",
      "typography",
      "surprise",
      "export-html",
    ]);
  });

  test("every prompt works on a copy beside the original and leaves the original alone", () => {
    for (const action of MAGIC_ACTIONS) {
      if (action.id === "export-html") continue;
      const prompt = magicPrompt(action.id);
      expect(prompt).toContain("copy_nodes");
      expect(prompt).toContain("Never edit or move the original");
    }
  });

  test("the prompts only name tools the agent has", () => {
    const names = new Set(agentTools.map((tool) => tool.name));
    for (const action of MAGIC_ACTIONS) {
      if (action.id === "export-html") continue;
      for (const [tool] of magicPrompt(action.id).matchAll(/\b[a-z]+_[a-z_]+\b/g)) {
        expect(names.has(tool)).toBe(true);
      }
    }
  });

  test("the chat shows a short title", () => {
    expect(magicDisplay({ label: "Color variation" })).toBe("Pego Magic · Color variation");
  });
});
