import { describe, expect, test } from "bun:test";
import { printable, sensitivePaths } from "./sensitive-paths";

const cli = async (stdin: string, ...args: string[]): Promise<string> => {
  const proc = Bun.spawn(["bun", `${import.meta.dir}/sensitive-paths.ts`, ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return out.trim();
};

describe("sensitivePaths", () => {
  test("flags CI, scripts, code owners, git attributes and submodules", () => {
    const paths = [
      ".github/workflows/ci.yml",
      ".github/workflows/new.yaml",
      ".github/scripts/sensitive-paths.ts",
      ".github/CODEOWNERS",
      ".github/dependabot.yml",
      ".github/actions/setup/action.yml",
      "CODEOWNERS",
      "docs/CODEOWNERS",
      ".gitattributes",
      "apps/web/.gitattributes",
      ".gitmodules",
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
      "apps/desktop/scripts/notarize.ts",
      "apps/desktop/scripts/sign/win.ts",
    ];
    expect(sensitivePaths(paths)).toEqual(paths);
  });

  test("flags the bridge, the desktop shell and the changelog's safety code", () => {
    const sensitive = [
      "packages/doc/src/schema.ts",
      "packages/doc/src/migrate.ts",
      "apps/bridge/src/security.ts",
      "apps/bridge/src/mcp.ts",
      "apps/bridge/src/editor-hub/run.ts",
      "apps/web/src/browser/page-scripts.ts",
      "apps/desktop/src/main.ts",
      "apps/desktop/src/preload.ts",
      "apps/desktop/src/browser-cdp.ts",
      "apps/desktop/src/updater.ts",
      "apps/changelog/src/lib/safe-markdown.ts",
      "apps/changelog/src/lib/entry-body.test.ts",
      "apps/changelog/src/content/schema.ts",
      "apps/changelog/src/content/entries.test.ts",
    ];
    expect(sensitivePaths(sensitive)).toEqual(sensitive);
  });

  test("ignores case, Unicode normalization and invisible characters", () => {
    const paths = [
      ".Claude/settings.json",
      "apps/web/claude.md",
      "docs/claude.md",
      ".MCP.json",
      "Bunfig.toml",
      "apps/web/Package.json",
      ".GitHub/Workflows/ci.yml",
      "Apps/Bridge/src/x.ts",
      "BUN.LOCK",
      ".claude\u200b/settings.json",
      "\u200dpackage.json",
      "apps/web/CLAUDE\u2060.md",
    ];
    expect(sensitivePaths(paths)).toEqual(paths);
  });

  test("leaves ordinary files alone", () => {
    expect(
      sensitivePaths([
        "apps/web/src/canvas/renderer.ts",
        "packages/doc/src/ops.ts",
        "packages/doc/src/schema.test.ts",
        "apps/web/src/browser/browser-actions.ts",
        "apps/bridge/README.md",
        "apps/desktop/build/icon.png",
        "apps/changelog/src/content/entries/a-faster-canvas.md",
        "apps/changelog/src/pages/index.astro",
        "README.md",
        "docs/guide.md",
        "github/workflows/ci.yml",
      ]),
    ).toEqual([]);
  });

  test("ignores blank lines, trims, and deduplicates", () => {
    expect(sensitivePaths(["", "  bun.lock  ", "./bun.lock", "\r"])).toEqual(["bun.lock"]);
  });
});

describe("printable", () => {
  test("escapes control characters so a path stays on one line", () => {
    expect(printable("a\nb\tc\u001b[31m\u0085")).toBe("a\\u000ab\\u0009c\\u001b[31m\\u0085");
    expect(printable(".github/x.yml")).toBe(".github/x.yml");
  });
});

describe("CLI", () => {
  test("prints sensitive paths, one per line", async () => {
    expect(await cli("README.md\nbun.lock\n")).toBe("bun.lock");
  });

  test("with -z, reads NUL-separated names and escapes newlines in them", async () => {
    expect(await cli("README.md\0.github/workflows/x.yml\0docs/a\nb.md\0", "-z")).toBe(
      ".github/workflows/x.yml",
    );
    expect(await cli("docs/x\n\0.github/a\nCLAUDE.md\0", "-z")).toBe(".github/a\\u000aCLAUDE.md");
    expect(await cli("README.md\0", "-z")).toBe("");
  });
});
