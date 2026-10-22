/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { nextThemeMode, resolveTheme } from "./theme";

describe("theme", () => {
  test("system follows the OS preference; explicit modes win", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });

  test("the toggle cycles light, dark, system", () => {
    expect([nextThemeMode("light"), nextThemeMode("dark"), nextThemeMode("system")]).toEqual([
      "dark",
      "system",
      "light",
    ]);
  });
});
