import { describe, expect, test } from "bun:test";
import { entryProblems } from "./changelog-entry";

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

  test("rejects entities and script-capable schemes, however spaced", () => {
    expect(entryProblems(entry(ok, "[x](&#106;avascript:alert(1))\n"))).toEqual([
      "html-entity (line 7)",
    ]);
    expect(entryProblems(entry(ok, "[x]( JaVa\tScRiPt :alert(1))\n"))).toEqual([
      "script-url (line 7)",
    ]);
    expect(entryProblems(entry(ok, "> [x]: vbscript:msgbox\n"))).toEqual(["script-url (line 7)"]);
    expect(entryProblems(entry(ok, "[x](java\nscript:alert(1))\n"))).toEqual([
      "script-url (across lines)",
    ]);
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
});
