/**
 * Text rules for changelog entries, which the site renders as HTML. They fail closed on the raw
 * text, code included, instead of parsing Markdown: no `<` at all (no raw HTML), no HTML entities
 * (`&#…` or `&name;`), and no `javascript:`, `vbscript:`, `data:` or `file:` anywhere once
 * lowercased with whitespace and control characters removed. The same rules apply to frontmatter
 * text. `.github/scripts/changelog-entry.ts` (the bot's own check) uses identical rules; keep them in
 * sync. The site strips unsafe HTML and URLs again when rendering (`safe-markdown.ts`).
 */
// eslint-disable-next-line no-control-regex -- control characters are what it removes
const IGNORED = /[\s\u0000-\u001f\u007f-\u009f]/g;
const hasScriptUrl = (text: string): boolean =>
  /javascript:|vbscript:|data:|file:/.test(text.toLowerCase().replace(IGNORED, ""));

const RULES: readonly (readonly [name: string, test: (line: string) => boolean])[] = [
  ["raw-html", (line) => line.includes("<")],
  ["html-entity", (line) => /&#|&[a-zA-Z][a-zA-Z0-9]*;/.test(line)],
  ["script-url", hasScriptUrl],
];

/** Rule violations in `text` as "rule (line n)"; never echoes the text itself. */
export const unsafeText = (text: string): string[] => {
  const problems = text
    .split("\n")
    .flatMap((line, index) =>
      RULES.filter(([, test]) => test(line)).map(([name]) => `${name} (line ${index + 1})`),
    );
  const split = hasScriptUrl(text) && !problems.some((problem) => problem.startsWith("script-url"));
  return split ? [...problems, "script-url (across lines)"] : problems;
};

/** True when a frontmatter string is safe as plain text anywhere: the body rules plus no `>`. */
export const isPlainText = (value: string): boolean =>
  !value.includes(">") && unsafeText(value).length === 0;
