/**
 * The changelog bot's own check of an entry it is about to commit (`changelog-check.yml`, job
 * `check`). It runs only this file (a sensitive path), never the changelog app's code: the full
 * schema and tests in apps/changelog run in CI on the commit afterwards. The text rules are the
 * same as apps/changelog/src/lib/entry-body.ts; keep them in sync. They fail closed on the raw
 * text (code included) instead of parsing Markdown: no `<`, no entities, and link, image,
 * reference and autolink destinations only http(s), mailto or relative, read after undoing what
 * Markdown and HTML decode (backslash escapes, entities) and what browsers skip (whitespace). Problems name a rule and a line, never the
 * offending text: they end up in a public check run.
 *
 * CLI: `bun .github/scripts/changelog-entry.ts <file>` prints the problems and exits 1, if any.
 */
const TAGS = new Set(["new", "improved", "fixed"]);
const KEYS = new Set(["title", "date", "summary", "tags"]);

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
 * `text` as a browser would see it in a URL: entities decoded (with or without `;`), backslashes
 * (Markdown escapes), whitespace and control characters removed, lowercase.
 */
const ENTITY = new RegExp(
  `&(?:#(\\d{1,8})|#x([0-9a-f]{1,8})|(${Object.keys(NAMED).join("|")}));?`,
  "gi",
);
const fold = (text: string): string =>
  text
    .replace(ENTITY, (_, dec, hex, name) =>
      dec !== undefined
        ? codePoint(Number(dec))
        : hex !== undefined
          ? codePoint(Number.parseInt(hex, 16))
          : (NAMED[String(name).toLowerCase()] ?? ""),
    )
    .toLowerCase()
    .replace(IGNORED, "");
const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
/**
 * What follows each `](` (link or image), `]:` (reference definition) and `<` (autolink), up to
 * a `)`, a quote (a title) or a blank line: generous, since parsers differ, and over line breaks.
 */
const destinations = (text: string): string[] =>
  [...text.matchAll(/(?:\][ \t]*[(:]|<)([^)"'<>]*)/g)].map(
    ([, rest = ""]) => rest.split(/\n[ \t]*\n/)[0] ?? "",
  );
/**
 * True when a destination's scheme, read as a browser would (see `fold`), is not http(s) or
 * mailto. Relative links and #fragments have none. Prose is not checked: "file: faster" is fine.
 */
const hasUnsafeLink = (text: string): boolean =>
  destinations(text).some((destination) => {
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(fold(destination))?.[1];
    return scheme !== undefined && !SAFE_SCHEMES.has(scheme);
  });

const RULES: readonly (readonly [name: string, test: (line: string) => boolean])[] = [
  ["raw-html", (line) => line.includes("<")],
  ["html-entity", (line) => /&#|&[a-zA-Z][a-zA-Z0-9]*;/.test(line)],
  ["link-scheme", hasUnsafeLink],
  ["secret-like", (line) => /sk-ant-|gh[psou]_[A-Za-z0-9]{20,}|[A-Za-z0-9+/_=-]{100,}/.test(line)],
];
const WHOLE = RULES.filter(([name]) => name === "link-scheme");

/** Rule violations in `text` as "rule (line n)", lines counted from `first`. */
export const unsafeText = (text: string, first = 1): string[] => {
  const problems = text
    .split("\n")
    .flatMap((line, index) =>
      RULES.filter(([, test]) => test(line)).map(([name]) => `${name} (line ${index + first})`),
    );
  // A destination split over lines (`](\njavascript:`, `](java\nscript:`).
  const split = WHOLE.filter(
    ([name, test]) => test(text) && !problems.some((problem) => problem.startsWith(`${name} `)),
  );
  return [...problems, ...split.map(([name]) => `${name} (across lines)`)];
};

const plain = (value: unknown, max: number): boolean =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= max &&
  !value.includes(">") &&
  unsafeText(value).length === 0;

/** Problems with one entry file's source; empty when the bot may commit it. */
export const entryProblems = (source: string): string[] => {
  if (source.length > 20_000) return ["too-long"];
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!match) return ["no-frontmatter"];
  const front = match[1] ?? "";
  const rawBody = match[2] ?? "";
  // The whole file, frontmatter included, must pass the text rules.
  const textProblems = unsafeText(source);
  let data: unknown;
  try {
    data = Bun.YAML.parse(front);
  } catch {
    return [...textProblems, "frontmatter-not-yaml"];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [...textProblems, "frontmatter-not-a-mapping"];
  }
  const fields = data as Record<string, unknown>;
  const date = fields.date instanceof Date ? fields.date : new Date(String(fields.date));
  const tags = fields.tags;
  return [
    ...textProblems,
    ...(Object.keys(fields).every((key) => KEYS.has(key)) ? [] : ["unexpected-field"]),
    ...(plain(fields.title, 80) ? [] : ["title"]),
    ...(plain(fields.summary, 160) ? [] : ["summary"]),
    ...(Number.isNaN(date.getTime()) ? ["date"] : []),
    ...(Array.isArray(tags) && tags.length > 0 && tags.every((tag) => TAGS.has(tag))
      ? []
      : ["tags"]),
    ...(rawBody.trim() === "" ? ["empty-body"] : []),
  ];
};

if (import.meta.main) {
  const file = process.argv[2];
  const problems = file ? entryProblems(await Bun.file(file).text()) : ["usage: <file>"];
  if (problems.length > 0) {
    console.log(problems.join("\n"));
    process.exit(1);
  }
}
