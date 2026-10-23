import { describe, expect, test } from "bun:test";
import { getPegoPrompt } from "./mcp-prompts";

const firstText = (name: string, args: Record<string, string>): string => {
  const content = getPegoPrompt(name, args)?.messages[0]?.content;
  return content?.type === "text" ? content.text : "";
};

describe("MCP prompts", () => {
  test("every prompt loads both core skills", () => {
    for (const text of [
      firstText("design_screen", { kind: "dashboard", brief: "Klinik" }),
      firstText("polish_selection", {}),
      firstText("extract_components", {}),
    ]) {
      expect(text).toContain('"core"');
      expect(text).toContain('"ui-polish"');
    }
  });
});
