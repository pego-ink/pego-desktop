/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown, safeHref, type Block, type Inline } from "./markdown";

const text = (value: string): Inline => ({ type: "text", text: value });
const para = (...children: Inline[]): Block => ({ type: "paragraph", children });

describe("inline", () => {
  test("bold, italic, strike, code", () => {
    expect(parseInline("a **b** *c* _d_ ~~e~~ `f`")).toEqual([
      text("a "),
      { type: "strong", children: [text("b")] },
      text(" "),
      { type: "em", children: [text("c")] },
      text(" "),
      { type: "em", children: [text("d")] },
      text(" "),
      { type: "del", children: [text("e")] },
      text(" "),
      { type: "code", text: "f" },
    ]);
  });

  test("nested emphasis and triple stars", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      { type: "strong", children: [text("a "), { type: "em", children: [text("b")] }, text(" c")] },
    ]);
    expect(parseInline("***x***")).toEqual([
      { type: "strong", children: [{ type: "em", children: [text("x")] }] },
    ]);
  });

  test("markers inside code are literal, escapes work", () => {
    expect(parseInline("`**no**`")).toEqual([{ type: "code", text: "**no**" }]);
    expect(parseInline("\\*not em\\* and \\`x")).toEqual([text("*not em* and `x")]);
  });

  test("intraword underscores and spaced stars stay literal", () => {
    expect(parseInline("snake_case_name")).toEqual([text("snake_case_name")]);
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
  });

  test("links and bare urls", () => {
    expect(parseInline("see [docs](https://a.dev/x?y=1) now")).toEqual([
      text("see "),
      { type: "link", href: "https://a.dev/x?y=1", children: [text("docs")] },
      text(" now"),
    ]);
    expect(parseInline("go to https://a.dev/path.")).toEqual([
      text("go to "),
      { type: "link", href: "https://a.dev/path", children: [text("https://a.dev/path")] },
      text("."),
    ]);
    expect(parseInline("(https://a.dev/x)")).toEqual([
      text("("),
      { type: "link", href: "https://a.dev/x", children: [text("https://a.dev/x")] },
      text(")"),
    ]);
    expect(parseInline("[m](mailto:a@b.co)")[0]).toMatchObject({ type: "link" });
  });

  test("unsafe links are not linked", () => {
    for (const bad of [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x](java\tscript:alert(1))",
      "[x](data:text/html;base64,AAAA)",
      "[x](vbscript:msgbox)",
      "[x](//evil.com)",
      "[x](/relative)",
    ]) {
      const nodes = parseInline(bad);
      expect(nodes.some((n) => n.type === "link")).toBe(false);
      expect(nodes).toEqual([text(bad)]);
    }
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://ok.dev")).toBe("https://ok.dev/");
  });

  test("raw html stays literal text", () => {
    const src = "<script>alert(1)</script> <img src=x onerror=alert(1)> <b>hi</b>";
    expect(parseInline(src)).toEqual([text(src)]);
    expect(parseMarkdown("<div onclick=x>hi</div>")).toEqual([
      para(text("<div onclick=x>hi</div>")),
    ]);
  });

  test("unclosed markers are literal", () => {
    expect(parseInline("this is **bold")).toEqual([text("this is **bold")]);
    expect(parseInline("a *em")).toEqual([text("a *em")]);
    expect(parseInline("a `code")).toEqual([text("a `code")]);
    expect(parseInline("a ~~gone")).toEqual([text("a ~~gone")]);
    // half-typed link: no anchor for the label, the bare URL part is still just a URL
    expect(parseInline("[half](https://a").some((n) => n.type === "strong")).toBe(false);
    expect(parseInline("[half](").every((n) => n.type === "text")).toBe(true);
    expect(parseInline("**")).toEqual([text("**")]);
  });

  test("soft line breaks become br", () => {
    expect(parseInline("a\nb")).toEqual([text("a"), { type: "br" }, text("b")]);
  });
});

describe("blocks", () => {
  test("paragraphs and headings", () => {
    expect(parseMarkdown("# One\n## Two\n### Three\n#### Four\n\nbody\ntext")).toEqual([
      { type: "heading", level: 1, children: [text("One")] },
      { type: "heading", level: 2, children: [text("Two")] },
      { type: "heading", level: 3, children: [text("Three")] },
      { type: "heading", level: 3, children: [text("Four")] },
      para(text("body"), { type: "br" }, text("text")),
    ]);
    expect(parseMarkdown("#hashtag")).toEqual([para(text("#hashtag"))]);
  });

  test("fenced code block with language, and unclosed fence while streaming", () => {
    expect(parseMarkdown("```ts\nconst a = **1**;\n\n  b\n```\nafter")).toEqual([
      { type: "code", lang: "ts", text: "const a = **1**;\n\n  b" },
      para(text("after")),
    ]);
    expect(parseMarkdown("intro\n```js\nlet x = 1")).toEqual([
      para(text("intro")),
      { type: "code", lang: "js", text: "let x = 1" },
    ]);
  });

  test("lists: bullets, ordered, start number", () => {
    expect(parseMarkdown("- a\n- b\n* c")).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [[para(text("a"))], [para(text("b"))], [para(text("c"))]],
      },
    ]);
    expect(parseMarkdown("3. x\n4. y")).toMatchObject([{ type: "list", ordered: true, start: 3 }]);
  });

  test("nested lists by indentation and wrapped items", () => {
    const [list] = parseMarkdown("- a\n  continued\n  - b\n    1. c\n- d\nlazy");
    expect(list).toEqual({
      type: "list",
      ordered: false,
      start: 1,
      items: [
        [
          para(text("a"), { type: "br" }, text("continued")),
          {
            type: "list",
            ordered: false,
            start: 1,
            items: [
              [
                para(text("b")),
                { type: "list", ordered: true, start: 1, items: [[para(text("c"))]] },
              ],
            ],
          },
        ],
        [para(text("d"), { type: "br" }, text("lazy"))],
      ],
    });
  });

  test("list interrupts a paragraph without blank line", () => {
    const blocks = parseMarkdown("**Title:**\n- one\n- two");
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: "list" });
  });

  test("blank line between items keeps one list", () => {
    const [list] = parseMarkdown("1. a\n\n2. b");
    expect(list).toMatchObject({ type: "list", ordered: true });
    expect((list as Extract<Block, { type: "list" }>).items).toHaveLength(2);
  });

  test("blockquote, hr", () => {
    expect(parseMarkdown("> q **b**\n> more\n\n---\n***")).toEqual([
      {
        type: "quote",
        children: [
          para(text("q "), { type: "strong", children: [text("b")] }, { type: "br" }, text("more")),
        ],
      },
      { type: "hr" },
      { type: "hr" },
    ]);
  });

  test("tables", () => {
    const [table] = parseMarkdown("| A | B |\n|:--|--:|\n| 1 | `x` |\n| 2 |");
    expect(table).toEqual({
      type: "table",
      align: ["left", "right"],
      head: [[text("A")], [text("B")]],
      rows: [
        [[text("1")], [{ type: "code", text: "x" }]],
        [[text("2")], []],
      ],
    });
    // header + delimiter only (streaming) still renders a table; a lone pipe line is a paragraph
    expect(parseMarkdown("a | b\n--|--")[0]).toMatchObject({ type: "table" });
    expect(parseMarkdown("a | b")[0]).toMatchObject({ type: "paragraph" });
  });

  test("deep nesting does not overflow the stack", () => {
    expect(() => parseMarkdown(">".repeat(20000) + " x")).not.toThrow();
    expect(() => parseMarkdown("- ".repeat(5000) + "x")).not.toThrow();
  });
});

describe("real example", () => {
  const sample = `Logonya sudah saya buat di frame **"Logo Sheet"** di kanvas. Anda tidak menyebut nama brand, jadi saya pakai **"pego"**, diambil dari nama dokumen ini.

**Desainnya:**
- **Simbol:** huruf "P" geometris berwarna putih di dalam kotak hijau ($accent) dengan sudut membulat.
- **Wordmark:** "pego" huruf kecil, Plus Jakarta Sans ExtraBold, warna tinta gelap.
- **Varian:**
  1. Logo utama di latar putih
  2. Versi gelap di latar tinta
  3. Ikon aplikasi (simbol saja) di latar mint
  4. Versi monokrom di latar hijau

Warnanya disimpan sebagai variabel ($accent, $mint, $ink, $paper), jadi bisa diganti dari satu tempat.`;

  test("parses into paragraph, lead-in, nested list and closing paragraph", () => {
    const blocks = parseMarkdown(sample);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list", "paragraph"]);
    const list = blocks[2] as Extract<Block, { type: "list" }>;
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(3);
    const variants = list.items[2] as Block[];
    expect(variants[0]).toEqual(para({ type: "strong", children: [text("Varian:")] }));
    const nested = variants[1] as Extract<Block, { type: "list" }>;
    expect(nested).toMatchObject({ type: "list", ordered: true, start: 1 });
    expect(nested.items).toHaveLength(4);
    expect(nested.items[3]).toEqual([para(text("Versi monokrom di latar hijau"))]);
    // no literal asterisks leak through anywhere
    expect(JSON.stringify(blocks)).not.toContain("**");
  });
});

describe("performance", () => {
  const time = (fn: () => void) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  test("20 KB realistic message parses quickly", () => {
    const chunk =
      "## Heading\n\nSome **bold** and `code` text with [a link](https://a.dev) and more words.\n\n- item *one*\n  - nested item\n- item two\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n";
    const source = chunk.repeat(Math.ceil(20_000 / chunk.length));
    expect(source.length).toBeGreaterThanOrEqual(20_000);
    expect(time(() => parseMarkdown(source))).toBeLessThan(300);
  });

  test("20 KB of unclosed markers stays fast", () => {
    for (const unit of ["*a ", "**a ", "`a ", "[a ", "_a ", "~~a ", "[a](b "]) {
      const source = unit.repeat(Math.ceil(20_000 / unit.length));
      expect(time(() => parseMarkdown(source))).toBeLessThan(300);
    }
  });
});
