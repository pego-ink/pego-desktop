/**
 * Text rules for changelog entries, which the site renders as HTML. They fail closed on the raw
 * text, code included, instead of parsing Markdown: no `<` at all (no raw HTML), no HTML entities
 * (`&#…` or `&name;`), no `javascript:`, `vbscript:`, `data:` or `file:` anywhere once entities
 * are decoded and backslashes (Markdown escapes), whitespace and control characters removed, and
 * link or image destinations only http(s), mailto or relative. The same rules apply to frontmatter
 * text. `.github/scripts/changelog-entry.ts` (the bot's own check) uses identical rules; keep them in
 * sync. The site strips unsafe HTML and URLs again when rendering (`safe-markdown.ts`).
 */
// eslint-disable-next-line no-control-regex -- control characters are what it removes
const IGNORED = /[\s\u0000-\u001f\u007f-\u009f\\]/g;
const NAMED: Readonly<Record<string, string>> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  amp: "&",
  sol: "/",
  bsol: "\\",
  lpar: "(",
  rpar: ")",
  period: ".",
  nbsp: " ",
};
const codePoint = (value: number): string =>
  value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "\ufffd";
/**
 * `text` as a browser would see it in a URL: entities decoded, backslashes (Markdown escapes),
 * whitespace and control characters removed, lowercase.
 */
const fold = (text: string): string =>
  text
    .replace(/&(?:#(\d{1,8})|#x([0-9a-f]{1,8})|([a-z][a-z0-9]*));?/gi, (entity, dec, hex, name) =>
      dec !== undefined
        ? codePoint(Number(dec))
        : hex !== undefined
          ? codePoint(Number.parseInt(hex, 16))
          : (NAMED[String(name).toLowerCase()] ?? entity),
    )
    .toLowerCase()
    .replace(IGNORED, "");
const hasScriptUrl = (text: string): boolean =>
  /javascript:|vbscript:|data:|file:/.test(fold(text));
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
/**
 * True when a link or image destination (`](dest` or a `[ref]: dest` definition) has a scheme
 * other than http(s) or mailto. Relative links and #fragments have none.
 */
const hasUnsafeLink = (text: string): boolean =>
  [...text.matchAll(/\]\s*[(:]\s*(\S*)/g)].some(([, destination = ""]) => {
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(fold(destination))?.[1];
    return scheme !== undefined && !SAFE_SCHEMES.has(scheme);
  });

const RULES: readonly (readonly [name: string, test: (line: string) => boolean])[] = [
  ["raw-html", (line) => line.includes("<")],
  ["html-entity", (line) => /&#|&[a-zA-Z][a-zA-Z0-9]*;/.test(line)],
  ["script-url", hasScriptUrl],
  ["link-scheme", hasUnsafeLink],
];
const WHOLE = RULES.filter(([name]) => name === "script-url" || name === "link-scheme");

/** Rule violations in `text` as "rule (line n)"; never echoes the text itself. */
export const unsafeText = (text: string): string[] => {
  const problems = text
    .split("\n")
    .flatMap((line, index) =>
      RULES.filter(([, test]) => test(line)).map(([name]) => `${name} (line ${index + 1})`),
    );
  // A destination or scheme split over lines (`](\njavascript:`, `java\nscript:`).
  const split = WHOLE.filter(
    ([name, test]) => test(text) && !problems.some((problem) => problem.startsWith(`${name} `)),
  );
  return [...problems, ...split.map(([name]) => `${name} (across lines)`)];
};

/** True when a frontmatter string is safe as plain text anywhere: the body rules plus no `>`. */
export const isPlainText = (value: string): boolean =>
  !value.includes(">") && unsafeText(value).length === 0;
