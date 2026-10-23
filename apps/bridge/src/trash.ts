import { existsSync } from "node:fs";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ProjectInfo } from "@pego/agent";
import { readMeta } from "./projects";
import { isDirectChild, trashCommand, trashInfoContent, trashName } from "./trash-plan";

/**
 * Move a project folder to the OS Trash (recoverable). The editor only sends a project id: the
 * folder is taken from the bridge's own project list and re-checked here, so a path from the
 * editor is never trusted.
 */

/**
 * The real folder of project `id`, or throws why it must not be trashed: unknown id, a symlink
 * (or a symlink anywhere on the way), not a direct child of the design folder, no project.json
 * or one with another id.
 */
export const resolveProjectFolder = async (
  root: string,
  projects: readonly ProjectInfo[],
  id: string,
): Promise<string> => {
  const project = projects.find((candidate) => candidate.id === id);
  if (!id || !project) throw new Error("That project does not exist (any more).");
  const dir = resolve(project.dir);
  const stat = await lstat(dir).catch(() => null);
  if (!stat) throw new Error("The project folder no longer exists.");
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("The project folder is a link, not a real folder; delete it by hand.");
  }
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  if (!isDirectChild(realRoot, realDir) || realDir !== join(realRoot, basename(dir))) {
    throw new Error("The project folder is not directly inside the design folder.");
  }
  const meta = await readMeta(realDir);
  if (!meta || meta.id !== id)
    throw new Error("The folder's project.json does not match this project.");
  return realDir;
};

export type TrashEnv = {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** Run a command, resolve with its exit code and stderr. */
  run: (cmd: string[], env: Record<string, string>) => Promise<{ code: number; stderr: string }>;
  which: (command: string) => string | null;
};

const run: TrashEnv["run"] = async (cmd, env) => {
  const child = Bun.spawn(cmd, {
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { code, stderr: stderr.trim() };
};

export const defaultTrashEnv = (): TrashEnv => ({
  platform: process.platform,
  home: homedir(),
  env: process.env,
  now: () => new Date(),
  run,
  which: (command) => Bun.which(command),
});

const isErrno = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;

const moveWithinVolume = async (from: string, to: string, trashDir: string): Promise<void> => {
  try {
    await rename(from, to);
  } catch (error) {
    if (isErrno(error, "EXDEV")) {
      throw new Error(
        `The project is on another disk than the Trash (${trashDir}); move it to the Trash by hand.`,
        { cause: error },
      );
    }
    throw error;
  }
};

const trashOnMac = async (dir: string, env: TrashEnv): Promise<void> => {
  const trash = join(env.home, ".Trash");
  await mkdir(trash, { recursive: true });
  const name = trashName(basename(dir), (n) => existsSync(join(trash, n)), env.now());
  await moveWithinVolume(dir, join(trash, name), trash);
};

/** Freedesktop Trash in `$XDG_DATA_HOME/Trash` (fallback when `gio` is missing). */
const trashOnLinuxXdg = async (dir: string, env: TrashEnv): Promise<void> => {
  const dataHome = env.env.XDG_DATA_HOME || join(env.home, ".local", "share");
  const trash = join(dataHome, "Trash");
  const [files, info] = [join(trash, "files"), join(trash, "info")];
  await Promise.all([mkdir(files, { recursive: true }), mkdir(info, { recursive: true })]);
  const name = trashName(
    basename(dir),
    (n) => existsSync(join(files, n)) || existsSync(join(info, `${n}.trashinfo`)),
    env.now(),
  );
  const infoFile = join(info, `${name}.trashinfo`);
  await writeFile(infoFile, trashInfoContent(dir, env.now()), { flag: "wx" });
  try {
    await moveWithinVolume(dir, join(files, name), trash);
  } catch (error) {
    await rm(infoFile, { force: true });
    throw error;
  }
};

const trashWithCommand = async (
  dir: string,
  env: TrashEnv,
  command: string[],
  vars: Record<string, string>,
) => {
  const result = await env.run(command, vars);
  if (result.code !== 0) {
    throw new Error(
      `Could not move the project to the Trash: ${result.stderr || `exit ${result.code}`}`,
    );
  }
};

/** Send an already validated project folder to the OS Trash. */
export const moveToTrash = async (
  dir: string,
  env: TrashEnv = defaultTrashEnv(),
): Promise<void> => {
  if (env.platform === "darwin") return trashOnMac(dir, env);
  if (env.platform === "linux") {
    const command = trashCommand("linux", dir)!;
    if (env.which("gio")) return trashWithCommand(dir, env, command.cmd, command.env);
    return trashOnLinuxXdg(dir, env);
  }
  const command = trashCommand(env.platform, dir);
  if (!command) throw new Error(`Moving to the Trash is not supported on ${env.platform}.`);
  return trashWithCommand(dir, env, command.cmd, command.env);
};

/** Validate project `id` against the bridge's list and move its folder to the Trash. */
export const trashProject = async (
  root: string,
  projects: readonly ProjectInfo[],
  id: string,
  env?: TrashEnv,
): Promise<void> => moveToTrash(await resolveProjectFolder(root, projects, id), env);
