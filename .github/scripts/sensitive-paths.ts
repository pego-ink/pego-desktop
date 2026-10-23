/**
 * Paths a PR into `dev` may only touch with an approving review from @yolkmonday on its head commit
 * (`.github/workflows/autopilot.yml`, job `gate`). The one list; edit it here.
 *
 * CLI: `git diff --name-only ... | bun .github/scripts/sensitive-paths.ts` prints the sensitive ones.
 * With `--expect <n>` (the PR's `changed_files`) it also prints INCOMPLETE_FILE_LIST when the list
 * cannot be the PR's whole file list, so the gate fails closed.
 */
export const SENSITIVE_PATTERNS = [
  // CI, bots and their scripts, code owners.
  ".github/**",
  "CODEOWNERS",
  "docs/CODEOWNERS",
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
  // Security-relevant source.
  "packages/doc/src/schema.ts",
  "packages/doc/src/migrate.ts",
  "apps/bridge/src/security.ts",
  "apps/desktop/src/browser-*",
  "apps/web/src/browser/page-scripts.ts",
  "apps/desktop/src/main.ts",
  "apps/desktop/src/preload.ts",
] as const;

/** Printed (and returned) when the PR's file list is not known to be complete. */
export const INCOMPLETE_FILE_LIST = "INCOMPLETE_FILE_LIST";

/** `GET /pulls/{n}/files` returns at most this many files, whatever the page size. */
export const PR_FILES_API_LIMIT = 3000;

const globs = SENSITIVE_PATTERNS.map((pattern) => new Bun.Glob(pattern));

const normalize = (path: string): string => path.trim().replace(/^\.\//, "");

/** Returns the paths (repo-relative, `/`-separated) that match a sensitive pattern, deduplicated. */
export const sensitivePaths = (paths: readonly string[]): string[] => [
  ...new Set(
    paths.map(normalize).filter((path) => path !== "" && globs.some((glob) => glob.match(path))),
  ),
];

/**
 * True when `filenames` (the PR's current file names, one per changed file) can be its whole file
 * list: as many as `changedFiles` and below the API cap.
 */
export const isCompleteFileList = (filenames: readonly string[], changedFiles: number): boolean => {
  const count = new Set(filenames.map(normalize).filter((path) => path !== "")).size;
  return Number.isInteger(changedFiles) && count === changedFiles && count < PR_FILES_API_LIMIT;
};

if (import.meta.main) {
  const flag = process.argv.indexOf("--expect");
  const input = (await Bun.stdin.text()).split("\n");
  // With --expect, stdin lines are "<filename>\t<previous filename or empty>".
  const rows = input.filter((line) => line.trim() !== "").map((line) => line.split("\t"));
  const result = sensitivePaths(rows.flat());
  if (flag !== -1) {
    const current = rows.map(([filename = ""]) => filename);
    if (!isCompleteFileList(current, Number(process.argv[flag + 1]))) {
      result.push(INCOMPLETE_FILE_LIST);
    }
  }
  if (result.length > 0) console.log(result.join("\n"));
}
