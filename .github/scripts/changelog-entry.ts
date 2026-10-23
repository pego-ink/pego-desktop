/**
 * The changelog bot's own check of an entry it is about to commit (`changelog-check.yml`, job
 * `check`). It runs only this file (a sensitive path), never the changelog app's code: the full
 * schema and tests in apps/changelog run in CI on the commit afterwards. The text rules are the
 * same as apps/changelog/src/lib/entry-body.ts; keep them in sync. They fail closed on the raw
 * text (code included) instead of parsing Markdown. Problems name a rule and a line, never the
 * offending text: they end up in a public check run.
 *
 * CLI: `bun .github/scripts/changelog-entry.ts <file>` prints the problems and exits 1, if any.
 */
const TAGS = new Set(["new", "improved", "fixed"]);
const KEYS = new Set(["title", "date", "summary", "tags"]);

// eslint-disable-next-line no-control-regex -- control characters are what it removes
const IGNORED = /[\s\u0000-\u001f\u007f-\u009f]/g;
const hasScriptUrl = (text: string): boolean =>
  /javascript:|vbscript:|data:|file:/.test(text.toLowerCase().replace(IGNORED, ""));

const RULES: readonly (readonly [name: string, test: (line: string) => boolean])[] = [
  ["raw-html", (line) => line.includes("<")],
  ["html-entity", (line) => /&#|&[a-zA-Z][a-zA-Z0-9]*;/.test(line)],
  ["script-url", hasScriptUrl],
  ["secret-like", (line) => /sk-ant-|gh[psou]_[A-Za-z0-9]{20,}|[A-Za-z0-9+/_=-]{100,}/.test(line)],
];

/** Rule violations in `text` as "rule (line n)", lines counted from `first`. */
export const unsafeText = (text: string, first = 1): string[] => {
  const problems = text
    .split("\n")
    .flatMap((line, index) =>
      RULES.filter(([, test]) => test(line)).map(([name]) => `${name} (line ${index + first})`),
    );
  const split = hasScriptUrl(text) && !problems.some((problem) => problem.startsWith("script-url"));
  return split ? [...problems, "script-url (across lines)"] : problems;
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
