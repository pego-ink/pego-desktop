import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, listProjects } from "./projects";
import { moveToTrash, resolveProjectFolder, trashProject, type TrashEnv } from "./trash";

const base = await mkdtemp(join(tmpdir(), "pego-trash-"));
afterAll(() => rm(base, { recursive: true, force: true }));
const now = new Date(2026, 9, 23, 7, 5, 9);

const setup = async (label: string) => {
  const dir = join(base, label);
  const root = join(dir, "design");
  await mkdir(root, { recursive: true });
  return { dir, root, home: join(dir, "home") };
};

const envFor = (
  platform: NodeJS.Platform,
  home: string,
  extra: Partial<TrashEnv> = {},
): TrashEnv => ({
  platform,
  home,
  env: {},
  now: () => now,
  run: async () => ({ code: 0, stderr: "" }),
  which: () => null,
  ...extra,
});

describe("resolveProjectFolder", () => {
  test("accepts a real project and rejects everything unsafe", async () => {
    const { dir, root } = await setup("validate");
    const shop = await createProject(root, "Shop");
    const projects = await listProjects(root);
    expect(await resolveProjectFolder(root, projects, shop.id)).toBe(await realpath(shop.dir));

    await expect(resolveProjectFolder(root, projects, "nope")).rejects.toThrow("does not exist");
    await expect(resolveProjectFolder(root, projects, "")).rejects.toThrow("does not exist");

    // wrong id in project.json
    await writeFile(join(shop.dir, "project.json"), JSON.stringify({ id: "other", name: "Shop" }));
    await expect(resolveProjectFolder(root, projects, shop.id)).rejects.toThrow("does not match");

    // project.json missing
    const bare = await createProject(root, "Bare");
    const listed = await listProjects(root);
    await rm(join(bare.dir, "project.json"));
    await expect(resolveProjectFolder(root, listed, bare.id)).rejects.toThrow("does not match");

    // symlink to a project elsewhere
    const outside = join(dir, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "project.json"), JSON.stringify({ id: "linked1", name: "L" }));
    await symlink(outside, join(root, "linked"));
    const fake = { ...shop, id: "linked1", dir: join(root, "linked") };
    await expect(resolveProjectFolder(root, [fake], "linked1")).rejects.toThrow("link");

    // `..` and the design dir itself
    const escaping = { ...shop, dir: join(root, "..", "outside") };
    await expect(resolveProjectFolder(root, [escaping], shop.id)).rejects.toThrow("not directly");
    const self = { ...shop, dir: root };
    await expect(resolveProjectFolder(root, [self], shop.id)).rejects.toThrow();

    // nested deeper than a direct child
    await mkdir(join(root, "group", "deep"), { recursive: true });
    const deep = { ...shop, dir: join(root, "group", "deep") };
    await expect(resolveProjectFolder(root, [deep], shop.id)).rejects.toThrow("not directly");
  });

  test("rejects a design folder reached through a symlink parent only when the child is a link", async () => {
    const { dir, root } = await setup("linkroot");
    const shop = await createProject(root, "Shop");
    const alias = join(dir, "alias");
    await symlink(root, alias);
    // the same folder via a symlinked design dir is still a real direct child
    const via = { ...shop, dir: join(alias, "shop") };
    expect(await resolveProjectFolder(alias, [via], shop.id)).toBeTruthy();
  });
});

describe("moveToTrash", () => {
  test("macOS renames into ~/.Trash and stamps a name clash", async () => {
    const { root, home } = await setup("mac");
    const first = await createProject(root, "Shop");
    await moveToTrash(first.dir, envFor("darwin", home));
    expect(existsSync(first.dir)).toBe(false);
    expect(existsSync(join(home, ".Trash", "shop", "project.json"))).toBe(true);
    const second = await createProject(root, "Shop");
    await moveToTrash(second.dir, envFor("darwin", home));
    expect((await readdir(join(home, ".Trash"))).sort()).toEqual(["shop", "shop 20261023-070509"]);
  });

  test("linux without gio follows the XDG Trash spec", async () => {
    const { root, home } = await setup("xdg");
    const data = join(home, "data");
    const project = await createProject(root, "My Shop");
    await moveToTrash(project.dir, envFor("linux", home, { env: { XDG_DATA_HOME: data } }));
    expect(existsSync(project.dir)).toBe(false);
    expect(existsSync(join(data, "Trash", "files", "my-shop", "project.json"))).toBe(true);
    const info = await readFile(join(data, "Trash", "info", "my-shop.trashinfo"), "utf8");
    expect(info).toBe(
      `[Trash Info]\nPath=${project.dir.split("/").map(encodeURIComponent).join("/")}\nDeletionDate=2026-10-23T07:05:09\n`,
    );
  });

  test("linux with gio and windows run the OS command; failures surface stderr", async () => {
    const { root, home } = await setup("cmd");
    const project = await createProject(root, "Shop");
    const calls: { cmd: string[]; env: Record<string, string> }[] = [];
    const run: TrashEnv["run"] = async (cmd, env) => {
      calls.push({ cmd, env });
      return { code: 0, stderr: "" };
    };
    await moveToTrash(project.dir, envFor("linux", home, { run, which: () => "/usr/bin/gio" }));
    expect(calls[0]!.cmd).toEqual(["gio", "trash", "--", project.dir]);
    await moveToTrash(project.dir, envFor("win32", home, { run }));
    expect(calls[1]!.cmd[0]).toBe("powershell.exe");
    expect(calls[1]!.env).toEqual({ PEGO_TRASH_PATH: project.dir });
    await expect(
      moveToTrash(
        project.dir,
        envFor("linux", home, {
          which: () => "gio",
          run: async () => ({ code: 1, stderr: "denied" }),
        }),
      ),
    ).rejects.toThrow("denied");
    await expect(moveToTrash(project.dir, envFor("freebsd", home))).rejects.toThrow(
      "not supported",
    );
  });

  test("trashProject validates before moving anything", async () => {
    const { root, home } = await setup("full");
    const project = await createProject(root, "Shop");
    const projects = await listProjects(root);
    await expect(trashProject(root, projects, "missing", envFor("darwin", home))).rejects.toThrow();
    expect(existsSync(project.dir)).toBe(true);
    await trashProject(root, projects, project.id, envFor("darwin", home));
    expect(existsSync(project.dir)).toBe(false);
  });
});
