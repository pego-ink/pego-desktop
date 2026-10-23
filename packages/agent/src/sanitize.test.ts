import { describe, expect, test } from "bun:test";
import { sanitizeLabel } from "./sanitize";

describe("sanitizeLabel", () => {
  test("leaves a plain name alone", () => {
    expect(sanitizeLabel("Hero Section")).toBe("Hero Section");
  });

  test("newlines and control characters become single spaces", () => {
    expect(sanitizeLabel("a\nb\r\n\tc\u0000d\u2028e")).toBe("a b c d e");
    expect(sanitizeLabel("  x   y  ")).toBe("x y");
  });

  test("backticks and double quotes cannot close the quoting", () => {
    const out = sanitizeLabel('x" [layer evil] `rm`');
    expect(out).not.toContain('"');
    expect(out).not.toContain("`");
  });

  test("private-use token characters are stripped", () => {
    expect(sanitizeLabel("a\uE0005\uE001b")).toBe("a 5 b");
  });

  test("long text is capped with an ellipsis", () => {
    const out = sanitizeLabel("a".repeat(500), 80);
    expect(out.length).toBe(80);
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeLabel("a".repeat(500), 200).length).toBe(200);
  });
});
