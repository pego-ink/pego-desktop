import { describe, expect, test } from "bun:test";
import { isMenuCommand } from "@/menu-channels";

describe("isMenuCommand", () => {
  test("accepts known commands only", () => {
    expect(isMenuCommand("select-all")).toBe(true);
    expect(isMenuCommand("close-tab")).toBe(true);
    expect(isMenuCommand("quit")).toBe(false);
    expect(isMenuCommand(undefined)).toBe(false);
    expect(isMenuCommand({ command: "select-all" })).toBe(false);
  });
});
