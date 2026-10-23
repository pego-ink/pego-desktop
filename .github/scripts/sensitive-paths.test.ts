import { describe, expect, test } from "bun:test";
import {
  INCOMPLETE_FILE_LIST,
  PR_FILES_API_LIMIT,
  isCompleteFileList,
  sensitivePaths,
} from "./sensitive-paths";

const cli = async (stdin: string, ...args: string[]): Promise<string> => {
  const proc = Bun.spawn(["bun", `${import.meta.dir}/sensitive-paths.ts`, ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
};

describe("sensitivePaths", () => {
  test("flags workflows, scripts and code owners", () => {
    const paths = [
      ".github/workflows/ci.yml",
      ".github/workflows/new.yaml",
      ".github/scripts/sensitive-paths.ts",
      ".github/CODEOWNERS",
      "CODEOWNERS",
      "docs/CODEOWNERS",
    ];
    expect(sensitivePaths(paths)).toEqual(paths);
  });

  test("flags agent configuration and instructions anywhere", () => {
    const paths = [
      ".claude/settings.json",
      ".claude/agents/x.md",
      "apps/web/.claude/settings.json",
      "CLAUDE.md",
      "apps/web/CLAUDE.md",
      "CLAUDE.local.md",
      ".mcp.json",
    ];
    expect(sensitivePaths(paths)).toEqual(paths);
  });

  test("flags every package.json, lockfile and runtime config", () => {
    const paths = [
      "package.json",
      "apps/web/package.json",
      "apps/desktop/package.json",
      "packages/doc/package.json",
      "bun.lock",
      "bunfig.toml",
      "apps/web/bunfig.toml",
      ".npmrc",
    ];
    expect(sensitivePaths(paths)).toEqual(paths);
  });

  test("flags deploy and build config", () => {
    const paths = [
      "apps/web/wrangler.jsonc",
      "apps/changelog/wrangler.jsonc",
      "apps/api/wrangler.toml",
      "apps/changelog/astro.config.ts",
      "apps/changelog/astro.config.mjs",
      "apps/desktop/electron-builder.yml",
    ];
    expect(sensitivePaths(paths)).toEqual(paths);
  });

  test("flags the listed source files exactly", () => {
    const sensitive = [
      "packages/doc/src/schema.ts",
      "packages/doc/src/migrate.ts",
      "apps/bridge/src/security.ts",
      "apps/web/src/browser/page-scripts.ts",
      "apps/desktop/src/main.ts",
      "apps/desktop/src/preload.ts",
      "apps/desktop/src/browser-cdp.ts",
      "apps/desktop/src/browser-url.test.ts",
    ];
    expect(sensitivePaths(sensitive)).toEqual(sensitive);
  });

  test("leaves ordinary files alone", () => {
    expect(
      sensitivePaths([
        "apps/web/src/canvas/renderer.ts",
        "packages/doc/src/ops.ts",
        "packages/doc/src/schema.test.ts",
        "apps/web/src/browser/browser-actions.ts",
        "apps/desktop/src/updater.ts",
        "apps/changelog/src/content/entries/a-faster-canvas.md",
        "apps/changelog/src/pages/index.astro",
        "README.md",
        "docs/guide.md",
        "docs/claude.md",
      ]),
    ).toEqual([]);
  });

  test("ignores blank lines, trims, and deduplicates", () => {
    expect(sensitivePaths(["", "  bun.lock  ", "./bun.lock", "\r"])).toEqual(["bun.lock"]);
  });
});

describe("isCompleteFileList", () => {
  test("accepts a list as long as changed_files", () => {
    expect(isCompleteFileList(["a.ts", "b.ts"], 2)).toBe(true);
  });

  test("rejects a short or padded list", () => {
    expect(isCompleteFileList(["a.ts"], 2)).toBe(false);
    expect(isCompleteFileList(["a.ts", "a.ts"], 2)).toBe(false);
    expect(isCompleteFileList(["a.ts", "b.ts"], Number.NaN)).toBe(false);
  });

  test("rejects a list at the API cap, even when the counts agree", () => {
    const files = Array.from({ length: PR_FILES_API_LIMIT }, (_, i) => `f${i}.ts`);
    expect(isCompleteFileList(files, PR_FILES_API_LIMIT)).toBe(false);
  });
});

describe("CLI", () => {
  test("prints sensitive paths", async () => {
    expect(await cli("README.md\nbun.lock\n")).toBe("bun.lock");
  });

  test("with --expect, checks renames' old paths and the file count", async () => {
    expect(await cli("docs/x.yml\t.github/workflows/x.yml\nREADME.md\t\n", "--expect", "2")).toBe(
      ".github/workflows/x.yml",
    );
    expect(await cli("README.md\t\n", "--expect", "2")).toBe(INCOMPLETE_FILE_LIST);
    expect(await cli("README.md\t\n", "--expect", "1")).toBe("");
  });
});
