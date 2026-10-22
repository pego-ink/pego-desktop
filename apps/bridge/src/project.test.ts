import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDesignFiles, readProjectFile, resolveDesignDir } from "./project";
import { answerProjectRequest } from "./server";

const repo = await mkdtemp(join(tmpdir(), "pego-project-"));
const design = join(repo, "design");
await mkdir(join(repo, ".git"));
await mkdir(join(design, "flows"), { recursive: true });
await mkdir(join(design, "node_modules"));
await mkdir(join(repo, "apps", "bridge"), { recursive: true });
await writeFile(join(design, "landing.pego"), '{"format":"pego"}');
await writeFile(join(design, "flows", "checkout.pego"), "{}");
await writeFile(join(design, "old.pen"), "{}");
await writeFile(join(design, "notes.md"), "#");
await writeFile(join(design, "node_modules", "x.pego"), "{}");
await writeFile(join(repo, "secret.pego"), "{}");
afterAll(() => rm(repo, { recursive: true, force: true }));

describe("design folder", () => {
  test("found from anywhere inside the repo, or set explicitly", () => {
    expect(resolveDesignDir({}, join(repo, "apps", "bridge"))).toBe(design);
    expect(resolveDesignDir({ PEGO_DESIGN_DIR: "design/flows" }, repo)).toBe(join(design, "flows"));
    expect(resolveDesignDir({ PEGO_DESIGN_DIR: "missing" }, repo)).toBeNull();
    expect(resolveDesignDir({}, tmpdir())).toBeNull();
  });

  test("lists .pego files recursively, skipping node_modules", async () => {
    const files = await listDesignFiles(design);
    expect(files.map((file) => file.relativePath)).toEqual(["flows/checkout.pego", "landing.pego"]);
    expect(files[1]).toMatchObject({ path: join(design, "landing.pego"), size: 17 });
  });

  test("reads files inside the folder only", async () => {
    expect(await readProjectFile(design, join(design, "landing.pego"))).toBe('{"format":"pego"}');
    expect(readProjectFile(design, join(repo, "secret.pego"))).rejects.toThrow(
      /Not in the project/,
    );
    expect(readProjectFile(design, join(design, "..", "secret.pego"))).rejects.toThrow(
      /Not in the project/,
    );
  });

  test("project requests answer with files or an error", async () => {
    const list = await answerProjectRequest(design, {
      type: "project_request",
      requestId: "1",
      action: "list",
    });
    expect(list).toMatchObject({
      type: "project_response",
      requestId: "1",
      ok: true,
      root: design,
    });
    const missing = await answerProjectRequest(null, {
      type: "project_request",
      requestId: "2",
      action: "list",
    });
    expect(missing).toMatchObject({ ok: false, error: "No design folder in this project." });
    const read = await answerProjectRequest(design, {
      type: "project_request",
      requestId: "3",
      action: "read",
      path: join(design, "flows", "checkout.pego"),
    });
    expect(read).toMatchObject({ ok: true, text: "{}" });
  });
});
