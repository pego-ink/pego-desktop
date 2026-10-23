import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectArg } from "./mcp";
import { createProject } from "./projects";

const root = await mkdtemp(join(tmpdir(), "pego-mcp-project-"));
afterAll(() => rm(root, { recursive: true, force: true }));

describe("the project argument of agent tools", () => {
  test("is split off and resolved by id or name", async () => {
    const shop = await createProject(root, "Shop");
    const byName = await resolveProjectArg({ project: "shop", nodeId: "a" }, root);
    expect(byName).toEqual({
      input: { nodeId: "a" },
      project: { id: shop.id, name: "Shop", dir: shop.dir, mainFile: shop.mainFile },
    });
    const byId = await resolveProjectArg({ project: shop.id }, root);
    expect("project" in byId && byId.project?.id).toBe(shop.id);
  });

  test("without it the call edits the shown document", async () => {
    expect(await resolveProjectArg({ nodeId: "a" }, root)).toEqual({ input: { nodeId: "a" } });
  });

  test("unknown or ambiguous projects and a missing design folder are errors that list choices", async () => {
    await createProject(root, "Shop Mobile");
    const unknown = await resolveProjectArg({ project: "nope" }, root);
    expect("error" in unknown && unknown.error).toStartWith('No project "nope". Projects: ');
    const ambiguous = await resolveProjectArg({ project: "sho" }, root);
    expect("error" in ambiguous && ambiguous.error).toContain("matches several projects");
    expect(await resolveProjectArg({ project: "Shop" }, null)).toEqual({
      error: "This bridge has no design folder, so it has no projects.",
    });
    expect(await resolveProjectArg({ project: 3 }, root)).toEqual({
      error: "project must be an id or a name.",
    });
  });
});
