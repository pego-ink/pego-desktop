import { describe, expect, test } from "bun:test";
import raw from "./google-fonts.json";
import { FONT_ALIASES, resolveFontFamily } from "./resolve-font";

const names = new Map(
  (raw.families as unknown[][]).map((f) => [String(f[0]).toLowerCase(), String(f[0])]),
);
const lookup = (name: string) => names.get(name.toLowerCase());

describe("resolveFontFamily", () => {
  test("every alias target exists in the catalog", () => {
    for (const target of new Set(Object.values(FONT_ALIASES))) {
      expect(lookup(target)).toBe(target);
    }
  });

  test("catalog families match case-insensitively and are returned canonically", () => {
    expect(resolveFontFamily(["open sans", "Arial"], lookup)).toBe("Open Sans");
    expect(resolveFontFamily(['"Geist"'], lookup)).toBe("Geist");
  });

  test("system stacks map in CSS order", () => {
    expect(
      resolveFontFamily(["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto"], lookup),
    ).toBe("Inter");
    expect(resolveFontFamily(["Helvetica Neue", "Helvetica", "Arial"], lookup)).toBe("Inter");
    expect(resolveFontFamily(["Arial", "sans-serif"], lookup)).toBe("Arimo");
    expect(resolveFontFamily(["Georgia", "serif"], lookup)).toBe("Tinos");
    expect(resolveFontFamily(["SF Mono", "Menlo", "monospace"], lookup)).toBe("JetBrains Mono");
    expect(resolveFontFamily(["Courier New"], lookup)).toBe("Cousine");
  });

  test("unknown families give undefined; a missing alias target is skipped", () => {
    expect(resolveFontFamily(["Totally Unknown"], lookup)).toBeUndefined();
    expect(
      resolveFontFamily(["Arial", "serif"], (n) => (n === "Tinos" ? "Tinos" : undefined)),
    ).toBe("Tinos");
  });
});
