import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ProjectInfo } from "@pego/agent";
import { listDesignFiles } from "./project";

/**
 * Projects are folders inside the design folder holding a project.json
 * (`{ "id": "k3m9x0qa", "name": "Checkout", "createdAt": "2026-10-22T..." }`). They live in the
 * repository, so everyone working on it sees the same projects.
 */

export const PROJECT_FILE = "project.json";
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

const newProjectId = (): string =>
  Array.from(randomBytes(8), (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");

/** Folder name for a project name: lowercase words joined by dashes. */
export const projectSlug = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";

const readMeta = async (
  dir: string,
): Promise<{ id: string; name: string; createdAt: string } | null> => {
  try {
    const json = JSON.parse(await readFile(join(dir, PROJECT_FILE), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof json.id !== "string" || typeof json.name !== "string") return null;
    return {
      id: json.id,
      name: json.name,
      createdAt: typeof json.createdAt === "string" ? json.createdAt : "",
    };
  } catch {
    return null;
  }
};

const describeProject = async (
  root: string,
  dir: string,
  meta: { id: string; name: string; createdAt: string },
): Promise<ProjectInfo> => {
  const files = await listDesignFiles(dir);
  return {
    id: meta.id,
    name: meta.name,
    dir,
    relativeDir: relative(root, dir).split(sep).join("/"),
    fileCount: files.length,
    modifiedAt: files.reduce((latest, file) => Math.max(latest, file.modifiedAt), 0),
    createdAt: meta.createdAt,
  };
};

/** Every project directly inside the design folder, most recently changed first. */
export const listProjects = async (root: string): Promise<ProjectInfo[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const projects: ProjectInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    const meta = await readMeta(dir);
    if (meta) projects.push(await describeProject(root, dir, meta));
  }
  return projects.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
};

/** Create design/<slug>/project.json (a new slug when the folder exists). */
export const createProject = async (root: string, name: string): Promise<ProjectInfo> => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A project needs a name.");
  const base = projectSlug(trimmed);
  let dir = join(root, base);
  for (let n = 2; existsSync(dir); n++) dir = join(root, `${base}-${n}`);
  await mkdir(dir);
  const meta = { id: newProjectId(), name: trimmed, createdAt: new Date().toISOString() };
  await writeFile(join(dir, PROJECT_FILE), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return describeProject(root, dir, meta);
};

/**
 * The project a user or agent means: exact id, then exact name (case-insensitive), then a unique
 * id or name prefix. Returns the matches when ambiguous.
 */
export const findProject = (
  projects: readonly ProjectInfo[],
  query: string,
): { project: ProjectInfo } | { matches: ProjectInfo[] } => {
  const q = query.trim().toLowerCase();
  const byId = projects.find((project) => project.id.toLowerCase() === q);
  if (byId) return { project: byId };
  const byName = projects.filter((project) => project.name.toLowerCase() === q);
  if (byName.length === 1) return { project: byName[0]! };
  const prefixed = projects.filter(
    (project) =>
      project.id.toLowerCase().startsWith(q) ||
      project.name.toLowerCase().startsWith(q) ||
      projectSlug(project.name).startsWith(projectSlug(q)),
  );
  if (prefixed.length === 1) return { project: prefixed[0]! };
  return { matches: byName.length > 1 ? byName : prefixed };
};
