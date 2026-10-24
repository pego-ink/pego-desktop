import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTitleBarMode, writeTitleBarMode } from "@/window-prefs";

const dir = mkdtempSync(join(tmpdir(), "pego-window-prefs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the title bar mode round-trips, defaulting to pego", () => {
  const file = join(dir, "nested", "window-prefs.json");
  expect(readTitleBarMode(file)).toBe("pego");
  writeTitleBarMode(file, "system");
  expect(readTitleBarMode(file)).toBe("system");
});

test("a broken or unknown file falls back to pego", () => {
  const file = join(dir, "broken.json");
  writeFileSync(file, "{not json");
  expect(readTitleBarMode(file)).toBe("pego");
  writeFileSync(file, JSON.stringify({ titleBar: "fancy" }));
  expect(readTitleBarMode(file)).toBe("pego");
});
