/**
 * Paths a PR into `dev` may only touch with an approving review from @yolkmonday on its head commit
 * (`.github/workflows/autopilot.yml`, job `gate`). The one list; edit it here.
 *
 * Matching ignores case (macOS and Windows disks do: `.Claude/settings.json` is `.claude/...`
 * there), Unicode normalization form and invisible format characters.
 *
 * CLI: `git diff --name-only -z ... | bun .github/scripts/sensitive-paths.ts -z` prints the
 * sensitive ones, one per line, control characters escaped as `\uXXXX`, so every line is one
 * path and safe to show. Without `-z` the input is one path per line.
 */
export const SENSITIVE_PATTERNS = [
  // CI, bots and their scripts, code owners, git attributes and submodules.
  ".github/**",
  "CODEOWNERS",
  "docs/CODEOWNERS",
  "**/.gitattributes",
  ".gitmodules",
  // Agent configuration and instructions: they steer Claude in CI and on every machine.
  ".claude/**",
  "**/.claude/**",
  "**/CLAUDE.md",
  "**/CLAUDE.local.md",
  ".mcp.json",
  // Dependencies, install and runtime config (install scripts, preloads, registries).
  "**/package.json",
  "bun.lock",
  "**/bunfig.toml",
  "**/.npmrc",
  // Deploy and build config.
  "**/wrangler.jsonc",
  "**/wrangler.json",
  "**/wrangler.toml",
  "apps/changelog/astro.config.*",
  "apps/desktop/electron-builder.yml",
  "apps/desktop/scripts/**",
  // Security-relevant source: the local bridge, the desktop shell, the changelog's HTML safety.
  "packages/doc/src/schema.ts",
  "packages/doc/src/migrate.ts",
  "apps/bridge/src/**",
  "apps/bridge/src/security.ts",
  "apps/desktop/src/**",
  "apps/desktop/src/browser-*",
  "apps/desktop/src/main.ts",
  "apps/desktop/src/preload.ts",
  "apps/web/src/browser/page-scripts.ts",
  "apps/changelog/src/lib/**",
  "apps/changelog/src/content/schema.ts",
  "apps/changelog/src/content/entries.test.ts",
] as const;

/** Characters most filesystems and editors do not show (zero-width, bidi controls, BOM, ...). */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/** The form paths are compared in: trimmed, no `./`, NFC, no invisible characters, lowercase. */
const fold = (path: string): string =>
  path.trim().replace(/^\.\//, "").normalize("NFC").replace(INVISIBLE, "").toLowerCase();

const globs = SENSITIVE_PATTERNS.map((pattern) => new Bun.Glob(fold(pattern)));

/** Returns the paths (repo-relative, `/`-separated) that match a sensitive pattern, deduplicated. */
export const sensitivePaths = (paths: readonly string[]): string[] => [
  ...new Set(
    paths
      .map((path) => path.trim().replace(/^\.\//, ""))
      .filter((path) => path !== "" && globs.some((glob) => glob.match(fold(path)))),
  ),
];

// eslint-disable-next-line no-control-regex -- control characters are what it escapes
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** A path as one printable line: control characters (newlines included) become `\uXXXX`. */
export const printable = (path: string): string =>
  path.replace(CONTROL, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

if (import.meta.main) {
  const separator = process.argv.includes("-z") ? "\0" : "\n";
  const result = sensitivePaths((await Bun.stdin.text()).split(separator));
  if (result.length > 0) console.log(result.map(printable).join("\n"));
}
