import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDITOR_OPS } from "@pego/agent";
import type { CallTool } from "./editor-hub";
import { runFileTool } from "./file-tools";
import { createProject, findProject, listProjects, projectSlug } from "./projects";

const root = await mkdtemp(join(tmpdir(), "pego-projects-"));
afterAll(() => rm(root, { recursive: true, force: true }));
const source = { kind: "mcp" as const };

describe("projects", () => {
  test("create writes project.json in a fresh folder; list finds them with file counts", async () => {
    const shop = await createProject(root, "Kirimi Shop");
    const again = await createProject(root, "kirimi shop!");
    expect(shop).toMatchObject({
      name: "Kirimi Shop",
      relativeDir: "kirimi-shop",
      fileCount: 1,
      hasMainFile: true,
      mainFile: join(shop.dir, "project.pego"),
    });
    const design = JSON.parse(await readFile(shop.mainFile, "utf8"));
    expect(design).toMatchObject({ format: "pego", version: 6, document: { name: "Kirimi Shop" } });
    expect(again.relativeDir).toBe("kirimi-shop-2");
    expect(shop.id).toMatch(/^[a-z0-9]{8}$/);
    const meta = JSON.parse(await readFile(join(shop.dir, "project.json"), "utf8"));
    expect(meta).toMatchObject({ id: shop.id, name: "Kirimi Shop" });
    // The design's document id is the project id (chat sessions key on it).
    expect(design.document.id).toBe(shop.id);

    await writeFile(join(shop.dir, "home.pego"), "{}");
    await mkdir(join(root, "assets"));
    const projects = await listProjects(root);
    expect(projects.map((p) => p.name)).toEqual(["Kirimi Shop", "kirimi shop!"]);
    expect(projects[0]!.fileCount).toBe(2);
  });

  test("find by id, by name, by prefix; ambiguity returns the matches", async () => {
    const projects = await listProjects(root);
    const [shop, other] = projects as [(typeof projects)[0], (typeof projects)[0]];
    expect(findProject(projects, shop.id)).toEqual({ project: shop });
    expect(findProject(projects, "KIRIMI SHOP")).toEqual({ project: shop });
    expect(findProject(projects, other.id.slice(0, 4))).toMatchObject({ project: other });
    expect(findProject(projects, "kirimi")).toMatchObject({ matches: [shop, other] });
    expect(projectSlug("Ünïcode Café")).toBe("unicode-cafe");
  });

  test("MCP: list_projects, open_project by name, create_project", async () => {
    const opened: unknown[] = [];
    const callTool: CallTool = async (tool, input) => {
      if (tool === EDITOR_OPS.openProject) opened.push(input);
      return { content: "ok", isError: false };
    };
    const listed = await runFileTool("list_projects", {}, callTool, source, root);
    expect(listed.content).toContain("- Kirimi Shop (id ");
    const open = await runFileTool(
      "open_project",
      { project: "kirimi shop" },
      callTool,
      source,
      root,
    );
    expect(open.content).toStartWith("Opened project Kirimi Shop");
    expect(open.content).toContain("project.pego is the active tab");
    expect(open.content).toContain("Other design files in the project:");
    expect(open.content).toContain("home.pego");
    expect(opened[0]).toMatchObject({ name: "Kirimi Shop" });
    const missing = await runFileTool("open_project", { project: "nope" }, callTool, source, root);
    expect(missing).toMatchObject({
      isError: true,
      content: expect.stringContaining('No project "nope"'),
    });
    const created = await runFileTool(
      "create_project",
      { name: "Dashboard" },
      callTool,
      source,
      root,
    );
    expect(created.content).toContain("It is now the active project.");
    expect(opened).toHaveLength(2);
  });
});
