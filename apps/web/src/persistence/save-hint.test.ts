import { describe, expect, test } from "bun:test";
import { untitledLabel } from "./save-hint";

describe("untitledLabel", () => {
  test("spells the save shortcut the way each platform writes it", () => {
    expect(untitledLabel(false, true)).toBe("Not saved to a file — ⌘S to save");
    expect(untitledLabel(false, false)).toBe("Not saved to a file — Ctrl+S to save");
  });
  test("the one-line title row next to the traffic lights says just Unsaved", () => {
    expect(untitledLabel(true, true)).toBe("Unsaved");
  });
});
