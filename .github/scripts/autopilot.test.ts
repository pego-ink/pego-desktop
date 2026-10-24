import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ap_changed_files (autopilot.sh) against real git histories: a bare "origin" with `dev`, and a
 * checkout of dev like the gate's, which fetches the PR head as objects only.
 */
const root = mkdtempSync(join(tmpdir(), "autopilot-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const SETUP = `
set -euo pipefail
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git init -q --bare -b dev origin.git
git -C origin.git config uploadpack.allowAnySHA1InWant true
git clone -q origin.git work 2>/dev/null
cd work
git checkout -q -b dev
mkdir -p apps/bridge/src apps/web/src
echo weak > apps/bridge/src/security.ts
echo a > apps/web/src/a.ts
git add -A && git commit -qm base && git push -q origin dev
`;

/** Runs `script` after SETUP in a fresh directory; returns what it prints and its exit code. */
const run = async (script: string): Promise<{ out: string; code: number }> => {
  const dir = mkdtempSync(join(root, "case-"));
  const proc = Bun.spawn(["bash", "-c", SETUP + script], {
    cwd: dir,
    env: { ...process.env, AP_SH: join(import.meta.dir, "autopilot.sh") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  return { out: out.trim(), code: await proc.exited };
};

/** Lists branch $1's head (run in work/) from a fresh checkout of dev, as the gate does. */
const LIST = `
list() {
  local sha; sha="$(git rev-parse "$1")"
  rm -rf ../gate && git clone -q ../origin.git ../gate 2>/dev/null
  (cd ../gate && source "$AP_SH" && ap_changed_files "$sha") | tr '\\0' '\\n' | sort -u
}
`;

describe("ap_changed_files", () => {
  test("lists a revert of another unmerged commit that the net diff hides", async () => {
    const { out, code } = await run(`${LIST}
      # The owner's PR S hardens security.ts in c1 (not merged yet).
      git checkout -q -b s dev
      echo strong > apps/bridge/src/security.ts
      git commit -qam c1 && git push -q origin s
      # A contributor's PR P branches from c1, reverts it and adds ui.ts.
      git checkout -q -b p s
      git revert --no-edit HEAD >/dev/null
      echo ui > apps/web/src/ui.ts
      git add -A && git commit -qm ui && git push -q origin p
      echo "net: $(git diff --name-only dev...p | tr '\\n' ' ')"
      echo "listed: $(list p | tr '\\n' ' ')"
    `);
    expect(code).toBe(0);
    // The net diff alone shows only ui.ts; the gate's list has security.ts too.
    expect(out).toBe(
      "net: apps/web/src/ui.ts \nlisted: apps/bridge/src/security.ts apps/web/src/ui.ts",
    );
  });

  test("lists a change hidden in a merge resolution, and both paths of a rename", async () => {
    const { out, code } = await run(`${LIST}
      git checkout -q -b side dev
      echo b > apps/web/src/b.ts
      git add -A && git commit -qm side
      git checkout -q -b p dev
      git mv apps/bridge/src/security.ts apps/bridge/src/safety.ts
      git commit -qm rename
      git merge -q --no-commit side 2>/dev/null || true
      echo evil > apps/web/src/a.ts
      git add -A && git commit -qm merge && git push -q origin p
      echo "listed: $(list p | tr '\\n' ' ')"
    `);
    expect(code).toBe(0);
    expect(out).toBe(
      "listed: apps/bridge/src/safety.ts apps/bridge/src/security.ts apps/web/src/a.ts apps/web/src/b.ts",
    );
  });

  test("fails on a bad or unknown commit", async () => {
    const { out, code } = await run(`${LIST}
      git clone -q ../origin.git ../gate 2>/dev/null && cd ../gate
      source "$AP_SH"
      ap_changed_files not-a-sha && echo bad-ok || echo "bad-failed"
      ap_changed_files ${"1".repeat(40)} 2>/dev/null && echo unknown-ok || echo "unknown-failed"
    `);
    expect(code).toBe(0);
    expect(out).toBe("bad-failed\nunknown-failed");
  });
});
