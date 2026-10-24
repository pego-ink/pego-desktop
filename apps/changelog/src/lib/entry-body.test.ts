import { describe, expect, test } from "bun:test";
import { isPlainText, unsafeText } from "@/lib/entry-body";

describe("unsafeText", () => {
  test("accepts plain markdown and safe links", () => {
    const body = [
      "## Faster canvas",
      "",
      "- Open [the docs](https://pego.ink/docs) or [settings](/settings#ai).",
      "- Mail [us](mailto:hi@pego.ink) & tell us > what you think.",
      "",
      "> A quote. Press `Tab` to switch.",
    ].join("\n");
    expect(unsafeText(body)).toEqual([]);
  });

  test("rejects any <, in code too, by line number only", () => {
    expect(unsafeText("ok\nHi <img src=x onerror=alert(1)>")).toEqual(["raw-html (line 2)"]);
    expect(unsafeText("```x`\n<img src=x onerror=alert(1)>\n```")).toEqual(["raw-html (line 2)"]);
    expect(unsafeText("Use `<Tab>`")).toEqual(["raw-html (line 1)"]);
  });

  test("rejects entities, and decodes them (with or without ;) before the scheme rule", () => {
    expect(unsafeText("[x](&#106;avascript:alert(1))")).toEqual([
      "html-entity (line 1)",
      "link-scheme (line 1)",
    ]);
    expect(unsafeText("[x](javascript&colon;alert(1))")).toContain("link-scheme (line 1)");
    expect(unsafeText("[x](javascript&colonalert(1))")).toEqual(["link-scheme (line 1)"]);
    expect(unsafeText("[x](&#106avascript:alert(1))")).toContain("link-scheme (line 1)");
    expect(unsafeText("[x](java&#x09;script:alert(1))")).toContain("link-scheme (line 1)");
    expect(unsafeText("a &lt;b&gt;")).toEqual(["html-entity (line 1)"]);
  });

  test("rejects script-capable destinations, however spaced, cased, escaped or split", () => {
    const script = ["link-scheme (line 1)"];
    expect(unsafeText("[x](javascript:alert(1))")).toEqual(script);
    expect(unsafeText("[x]( JaVa\tScRiPt :alert(1))")).toEqual(script);
    expect(unsafeText("> [x]: vbscript:msgbox")).toEqual(script);
    expect(unsafeText("![x](data:image/svg+xml;base64,PHN2Zz4=)")).toEqual(script);
    expect(unsafeText("[x](javascript\\:alert(1))")).toEqual(script);
    expect(unsafeText("[x](\\javascript\\:alert(1))")).toEqual(script);
    expect(unsafeText("[x](file:///etc/passwd 'title')")).toEqual(script);
    expect(unsafeText("<javascript:alert(1)>")).toEqual([
      "raw-html (line 1)",
      "link-scheme (line 1)",
    ]);
    expect(unsafeText("[x](java\nscript:alert(1))")).toEqual(["link-scheme (across lines)"]);
    expect(unsafeText("[x]: \n  javascript:alert(1)")).toEqual(["link-scheme (across lines)"]);
  });

  test("allows only http(s), mailto and relative link destinations", () => {
    expect(unsafeText("[a](HTTPS://pego.ink) [b](./x) [c](a/b:c) [d](#x) [e]: /y")).toEqual([]);
    expect(unsafeText("[a](https://pego.ink \"Title: here\") and [b](/x 'Note: y')")).toEqual([]);
    expect(unsafeText("Tip: press Tab. [Note] it is fast.")).toEqual([]);
    expect(unsafeText("[x](tel:123)")).toEqual(["link-scheme (line 1)"]);
    expect(unsafeText("[x](\n  ftp://a)")).toEqual(["link-scheme (across lines)"]);
    expect(unsafeText("[y]: blob:https://a")).toEqual(["link-scheme (line 1)"]);
  });

  test("lets prose use words that look like schemes", () => {
    for (const prose of [
      "Exports keep metadata: names",
      "Open a big file: faster",
      "Profile: new",
      "Data: kept.\n\nJavaScript: faster. See [docs](https://pego.ink).",
    ]) {
      expect([prose, unsafeText(prose)]).toEqual([prose, []]);
    }
  });
});

describe("isPlainText", () => {
  test("rejects angle brackets, entities and unsafe links", () => {
    expect(isPlainText("A faster canvas")).toBe(true);
    expect(isPlainText("Profile: new")).toBe(true);
    expect(isPlainText("</script><script>alert(1)</script>")).toBe(false);
    expect(isPlainText("a > b")).toBe(false);
    expect(isPlainText("&#60;b")).toBe(false);
    expect(isPlainText("[x](javascript:void)")).toBe(false);
  });
});
