import { existsSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ProjectFile } from "@pego/agent";
import { FileToolError, readDocumentFile } from "./files";

const DESIGN_FOLDER = "design";
const MAX_FILES = 500;
const DOCUMENT_EXTENSIONS = new Set([".pego", ".pen"]);
const SKIPPED = new Set(["node_modules", ".git"]);

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The project's design folder: PEGO_DESIGN_DIR when set (relative to `cwd`), else `design/` in
 * the nearest folder above `cwd` that is a git repository. Null when there is none.
 */
export const resolveDesignDir = (
  env: Record<string, string | undefined>,
  cwd: string,
): string | null => {
  const configured = env.PEGO_DESIGN_DIR?.trim();
  if (configured) {
    const dir = isAbsolute(configured) ? configured : resolve(cwd, configured);
    return isDirectory(dir) ? dir : null;
  }
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) {
      const design = join(dir, DESIGN_FOLDER);
      return isDirectory(design) ? design : null;
    }
    if (dirname(dir) === dir) return null;
  }
};

/** Every .pego/.pen file under `root` (hidden folders and node_modules skipped), sorted by path. */
export const listDesignFiles = async (root: string): Promise<ProjectFile[]> => {
  const files: ProjectFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const info = await stat(path);
        files.push({
          path,
          relativePath: relative(root, path).split(sep).join("/"),
          size: info.size,
          modifiedAt: info.mtimeMs,
        });
      }
    }
  };
  await walk(root);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

/** Read a design file that must live inside `root` (the project panel never reaches outside). */
export const readProjectFile = async (root: string, path: string): Promise<string> => {
  const target = resolve(path);
  if (!target.startsWith(root + sep)) {
    throw new FileToolError(`Not in the project's design folder: ${path}`);
  }
  return readDocumentFile(target);
};
