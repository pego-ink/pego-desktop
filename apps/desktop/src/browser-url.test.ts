import { describe, expect, test } from "bun:test";
import { normalizeBrowserUrl } from "@/browser-url";

const url = (input: string): string | null => {
  const r = normalizeBrowserUrl(input);
  return r.ok ? r.url : null;
};

describe("normalizeBrowserUrl", () => {
  test("file only with allowFile", () => {
    expect(normalizeBrowserUrl("file:///tmp/a.html").ok).toBe(false);
    const r = normalizeBrowserUrl("file:///tmp/a.html", { allowFile: true });
    expect(r.ok && r.url).toBe("file:///tmp/a.html");
    expect(normalizeBrowserUrl("javascript:alert(1)", { allowFile: true }).ok).toBe(false);
  });
  test("keeps http and https", () => {
    expect(url("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(url("http://example.com")).toBe("http://example.com/");
  });
  test("bare hosts get https", () => {
    expect(url("example.com")).toBe("https://example.com/");
    expect(url("example.com/docs")).toBe("https://example.com/docs");
    expect(url("  example.com:8443/x ")).toBe("https://example.com:8443/x");
  });
  test("local hosts get http", () => {
    expect(url("localhost:3000")).toBe("http://localhost:3000/");
    expect(url("localhost")).toBe("http://localhost/");
    expect(url("127.0.0.1:5173/app")).toBe("http://127.0.0.1:5173/app");
    expect(url("[::1]:8080")).toBe("http://[::1]:8080/");
  });
  test("allows about:blank only", () => {
    expect(url("about:blank")).toBe("about:blank");
    expect(url("about:config")).toBeNull();
  });
  test("rejects dangerous schemes and empty input", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,hi",
      "chrome://settings",
      "devtools://devtools/bundled/inspector.html",
      "ftp://example.com",
      "",
      "   ",
    ]) {
      expect(normalizeBrowserUrl(bad).ok).toBe(false);
    }
    expect(normalizeBrowserUrl(42).ok).toBe(false);
  });
});
