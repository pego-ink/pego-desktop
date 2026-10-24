import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { entryProblems, unsafeText } from "./changelog-entry";

const entry = (frontmatter: string, body = "## What changed\n\nIt is faster.\n") =>
  `---\n${frontmatter}\n---\n${body}`;
const ok =
  "title: A faster canvas\ndate: 2026-10-23T10:00:00Z\nsummary: Panning is smoother.\ntags: [improved]";

describe("entryProblems", () => {
  test("accepts a plain entry with safe links and a quote", () => {
    expect(
      entryProblems(entry(ok, "> Quote. See [docs](https://pego.ink/docs) & more.\n")),
    ).toEqual([]);
  });

  test("rejects any <, in code too, and never echoes the text", () => {
    const problems = entryProblems(entry(ok, "```x`\n<img src=x onerror=alert(1)>\n```\n"));
    expect(problems).toEqual(["raw-html (line 8)"]);
    expect(entryProblems(entry(ok, "Press `<Tab>`.\n"))).toEqual(["raw-html (line 7)"]);
  });

  test("rejects HTML in frontmatter", () => {
    const problems = entryProblems(entry(ok.replace("A faster canvas", "</script>x")));
    expect(problems).toEqual(["raw-html (line 2)", "title"]);
    expect(entryProblems(entry(ok.replace("Panning is smoother.", "a > b")))).toEqual(["summary"]);
  });

  test("rejects entities, and script-capable destinations however spaced", () => {
    expect(entryProblems(entry(ok, "[x](&#106;avascript:alert(1))\n"))).toEqual([
      "html-entity (line 7)",
      "link-scheme (line 7)",
    ]);
    expect(entryProblems(entry(ok, "[x](&#106avascript&colon;alert(1))\n"))).toEqual([
      "html-entity (line 7)",
      "link-scheme (line 7)",
    ]);
    expect(entryProblems(entry(ok, "[x]( JaVa\tScRiPt :alert(1))\n"))).toEqual([
      "link-scheme (line 7)",
    ]);
    expect(entryProblems(entry(ok, "> [x]: vbscript:msgbox\n"))).toEqual(["link-scheme (line 7)"]);
    expect(entryProblems(entry(ok, "[x](java\nscript:alert(1))\n"))).toEqual([
      "link-scheme (across lines)",
    ]);
    expect(entryProblems(entry(ok, "[x](\njavascript:alert(1))\n"))).toEqual([
      "link-scheme (across lines)",
    ]);
  });

  test("rejects schemes hidden by Markdown backslash escapes", () => {
    expect(entryProblems(entry(ok, "[x](javascript\\:alert(1))\n"))).toEqual([
      "link-scheme (line 7)",
    ]);
    expect(entryProblems(entry(ok, "[x](java\\script\\:alert(1))\n"))).toEqual([
      "link-scheme (line 7)",
    ]);
  });

  test("allows only http(s), mailto and relative link destinations", () => {
    const safe =
      "[a](https://pego.ink) [b](http://x.y) [c](mailto:hi@pego.ink) [d](/x#y) [e](#top)";
    expect(entryProblems(entry(ok, `${safe}\n`))).toEqual([]);
    expect(entryProblems(entry(ok, "Tip: press Tab. Note: it is fast.\n"))).toEqual([]);
    expect(entryProblems(entry(ok, "[x](tel:123)\n"))).toEqual(["link-scheme (line 7)"]);
    expect(entryProblems(entry(ok, "![x](ftp://a/b.png)\n"))).toEqual(["link-scheme (line 7)"]);
    expect(entryProblems(entry(ok, "[x][y]\n\n[y]:\n  tel\\:123\n"))).toEqual([
      "link-scheme (across lines)",
    ]);
  });

  test("lets prose use words that look like schemes", () => {
    for (const prose of [
      "Exports keep metadata: names",
      "Open a big file: faster",
      "Profile: new",
      "Data: kept. File: saved. JavaScript: faster.",
    ]) {
      expect([prose, entryProblems(entry(ok, `${prose}\n`))]).toEqual([prose, []]);
    }
    const front = ok
      .replace("A faster canvas", '"Profile: new"')
      .replace("Panning is smoother.", '"File: panning is smoother."');
    expect(entryProblems(entry(front))).toEqual([]);
  });

  test("rejects token-like strings", () => {
    expect(entryProblems(entry(ok, `Note: ${"QUJD".repeat(30)}\n`))).toEqual([
      "secret-like (line 7)",
    ]);
    expect(entryProblems(entry(ok, "Key sk-ant-oat01-abc\n"))).toEqual(["secret-like (line 7)"]);
  });

  test("rejects unknown fields, bad tags, long summaries and no frontmatter", () => {
    expect(entryProblems(entry(`${ok}\nimage: ./x.png`))).toEqual(["unexpected-field"]);
    expect(entryProblems(entry(ok.replace("[improved]", "[shiny]")))).toEqual(["tags"]);
    expect(entryProblems(entry(ok.replace("Panning is smoother.", "ab ".repeat(54))))).toEqual([
      "summary",
    ]);
    expect(entryProblems("just text")).toEqual(["no-frontmatter"]);
    expect(entryProblems(entry(ok, "\n"))).toEqual(["empty-body"]);
  });

  // Human entries may carry `version` (the bot may not), so only the text rules apply here.
  test("every existing entry passes the bot's text rules", () => {
    const dir = join(import.meta.dir, "../../apps/changelog/src/content/entries");
    const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect([name, unsafeText(readFileSync(join(dir, name), "utf8"))]).toEqual([name, []]);
    }
  });
});
