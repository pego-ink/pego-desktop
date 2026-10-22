import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test helper: a directory holding fake executables (POSIX shell scripts) to put on a child's PATH.
 * Each script is given as its full text, so tests can model a CLI's `--version`, login probe and
 * run mode in a few lines.
 */
export const makeFakeBin = async (scripts: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "pego-fakebin-"));
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
    await chmod(path, 0o755);
  }
  return dir;
};

/** Single-quote a string for use inside a shell script. */
export const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await Bun.sleep(10);
  }
  return false;
};
