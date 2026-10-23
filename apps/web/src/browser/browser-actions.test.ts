import { describe, expect, test } from "bun:test";
import { actionMessage } from "./browser-actions";

describe("actionMessage", () => {
  test("import success reports layers and skipped parts", () => {
    const content = JSON.stringify({ ok: true, nodeCount: 12, warnings: ["a", "b"] });
    expect(actionMessage("import-to-canvas", { content, isError: false })).toBe(
      "Imported to the canvas (12 layers), 2 skipped",
    );
  });

  test("screenshot success", () => {
    const content = JSON.stringify({ ok: true, created: { id: "x" } });
    expect(actionMessage("screenshot-to-canvas", { content, isError: false })).toBe(
      "Screenshot placed on the canvas",
    );
  });

  test("errors show the tool's message", () => {
    const content = JSON.stringify({ error: { code: "no_page", message: "No page loaded" } });
    expect(actionMessage("import-to-canvas", { content, isError: true })).toBe("No page loaded");
  });

  test("non-JSON content falls back to its first line", () => {
    expect(actionMessage("import-to-canvas", { content: "boom\nmore", isError: true })).toBe(
      "boom",
    );
  });
});
