import { describe, expect, test } from "bun:test";
import { serializeJsonLd } from "@/lib/json-ld";

describe("serializeJsonLd", () => {
  test("cannot close the script element", () => {
    const out = serializeJsonLd({ headline: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toBe(
      '{"headline":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}',
    );
  });

  test("escapes &, comments and line separators", () => {
    const out = serializeJsonLd({ a: "<!-- & \u2028\u2029" });
    expect(out).toBe('{"a":"\\u003c!-- \\u0026 \\u2028\\u2029"}');
  });

  test("still parses to the same value", () => {
    const value = { headline: "a < b & c > d \u2028", n: 1, list: ["</x>"] };
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
  });
});
