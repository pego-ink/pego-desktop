import { existsSync } from "node:fs";
import { join } from "node:path";

const exeName = process.platform === "win32" ? "claude.exe" : "claude";

/** Platform packages the Agent SDK ships its bundled CLI in. */
const bundledPackages = (): string[] => {
  const base = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  return process.platform === "linux" ? [base, `${base}-musl`] : [base];
};

/**
 * Locate a Claude Code executable: the SDK's bundled binary first, else `claude` on PATH.
 * Returns `undefined` when none is found. There is no cheap offline login check, so a missing
 * login surfaces later as a run `error` event.
 */
export const resolveClaudeExecutable = (): string | undefined => {
  for (const pkg of bundledPackages()) {
    try {
      const resolved = Bun.resolveSync(`${pkg}/package.json`, import.meta.dir);
      const candidate = join(resolved, "..", exeName);
      if (existsSync(candidate)) return candidate;
    } catch {
      // package not installed for this platform
    }
  }
  return Bun.which("claude") ?? undefined;
};

export const isClaudeCodeAvailable = (): boolean => resolveClaudeExecutable() !== undefined;
