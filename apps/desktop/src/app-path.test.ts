import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAppFile } from "@/app-path";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pego-app-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<html></html>");
  await writeFile(join(root, "assets", "a.js"), "1");
});
afterAll(() => rm(root, { recursive: true, force: true }));

test("serves existing files and index at root", async () => {
  expect(await resolveAppFile(root, "/assets/a.js")).toBe(join(root, "assets", "a.js"));
  expect(await resolveAppFile(root, "/")).toBe(join(root, "index.html"));
});

test("extension-less unknown paths fall back to index.html, missing assets 404", async () => {
  expect(await resolveAppFile(root, "/some/route")).toBe(join(root, "index.html"));
  expect(await resolveAppFile(root, "/assets/missing.js")).toBeNull();
});

test("rejects traversal and malformed paths", async () => {
  // Traversal is clamped to the root: never a file outside it.
  expect(await resolveAppFile(root, "/../../etc/passwd")).toBe(join(root, "index.html"));
  expect(await resolveAppFile(root, "/%2e%2e/%2e%2e/etc/hosts.txt")).toBeNull();
  expect(await resolveAppFile(root, "/a%00b")).toBeNull();
  expect(await resolveAppFile(root, "/%E0%A4%A")).toBeNull();
});
