import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { MAX_SVG_BYTES } from "@pego/agent";
import { FileToolError } from "./files";

/** Same limit as insert_svg, so a file read here can always be placed. */
export const MAX_READ_SVG_BYTES = MAX_SVG_BYTES;
/** Entries (files plus folders) one list_files call returns. */
export const MAX_LISTED = 500;
const DESIGN_FOLDER = "design";
const SKIPPED = new Set(["node_modules", ".git"]);

const NO_DESIGN_DIR =
  "No design folder: run the bridge inside a repository with design/ or set PEGO_DESIGN_DIR.";

export type ResolvedDesignPath = {
  /** Real absolute path, built from the real design root plus checked segments. */
  abs: string;
  /** Posix path relative to the design root ("" for the root itself). */
  rel: string;
  /** Real absolute design root. */
  root: string;
  /** What lstat said about the target. */
  kind: "directory" | "file" | "other";
};

const isInside = (root: string, path: string) => path === root || path.startsWith(root + sep);

/**
 * Resolve a user/agent path against the design folder. The path is relative to the design root
 * (a leading `design/` is dropped); an absolute path must already be inside it. Nothing may
 * escape (`..`, absolute elsewhere) and no part of the path may be a symlink: every segment is
 * lstat-ed, so a link inside design/ (to a file or folder, in or out of the tree) is refused
 * instead of followed. Errors never contain file contents.
 */
export const resolveInsideDesignDir = async (
  designDir: string | null,
  input: string,
): Promise<ResolvedDesignPath> => {
  if (!designDir) throw new FileToolError(NO_DESIGN_DIR);
  const root = await realpath(designDir).catch(() => null);
  if (!root) throw new FileToolError(NO_DESIGN_DIR);
  if (input.includes("\0")) throw new FileToolError("Invalid path.");

  const text = input.trim();
  let target: string;
  if (isAbsolute(text)) {
    target = resolve(text);
    // The caller may know the root by its symlinked or its real name.
    const lexicalRoot = resolve(designDir);
    if (isInside(lexicalRoot, target) && lexicalRoot !== root) {
      target = resolve(root, target.slice(lexicalRoot.length + 1));
    }
  } else {
    const parts = text.split("/").filter((part) => part !== "" && part !== ".");
    if (parts[0] === DESIGN_FOLDER) parts.shift();
    target = resolve(root, ...parts);
  }
  if (!isInside(root, target)) {
    throw new FileToolError(`Not in the design folder: ${input}`);
  }

  const segments = target === root ? [] : target.slice(root.length + 1).split(sep);
  let current = root;
  let kind: ResolvedDesignPath["kind"] = "directory";
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) throw new FileToolError(`Not found in the design folder: ${input}`);
    if (info.isSymbolicLink()) {
      throw new FileToolError(`Refusing to follow a link in the design folder: ${input}`);
    }
    kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
  }
  // Belt and braces: the real location must still be inside the real root.
  const real = await realpath(current).catch(() => null);
  if (!real || !isInside(root, real)) {
    throw new FileToolError(`Not in the design folder: ${input}`);
  }
  return { abs: current, rel: segments.join("/"), root, kind };
};

const isSvgName = (name: string) => extname(name).toLowerCase() === ".svg";
const joinRel = (rel: string, name: string) => (rel ? `${rel}/${name}` : name);

export type SvgListing = {
  /** The folder listed, relative to the design root ("" is the root). */
  path: string;
  files: { path: string; bytes: number }[];
  /** Subfolders (only when not recursive), as paths relative to the design root. */
  folders: string[];
  truncated: boolean;
};

/** The .svg files in a folder of the design root (hidden folders, node_modules and symlinks skipped). */
export const listDesignSvgs = async (
  designDir: string | null,
  path: string | undefined,
  recursive: boolean,
): Promise<SvgListing> => {
  const start = await resolveInsideDesignDir(designDir, path ?? "");
  if (start.kind !== "directory") throw new FileToolError(`Not a folder: ${path ?? ""}`);
  const files: SvgListing["files"] = [];
  const folders: string[] = [];
  let truncated = false;

  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name)) continue;
      // Dirent reports a symlink as neither file nor directory, so links are never followed.
      const wanted = entry.isDirectory() ? !recursive : entry.isFile() && isSvgName(entry.name);
      const walks = entry.isDirectory() && recursive;
      if (!wanted && !walks) continue;
      if (files.length + folders.length >= MAX_LISTED) {
        truncated = true;
        return;
      }
      const entryRel = joinRel(rel, entry.name);
      const entryPath = join(dir, entry.name);
      if (walks) await walk(entryPath, entryRel);
      else if (entry.isDirectory()) folders.push(entryRel);
      else files.push({ path: entryRel, bytes: (await lstat(entryPath)).size });
      if (truncated) return;
    }
  };
  await walk(start.abs, start.rel);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { path: start.rel, files, folders, truncated };
};

/** The markup of one .svg file in the design root, ready for insert_svg. */
export const readDesignSvg = async (
  designDir: string | null,
  path: string,
): Promise<{ path: string; bytes: number; svg: string }> => {
  const target = await resolveInsideDesignDir(designDir, path);
  if (target.kind !== "file") throw new FileToolError(`Not a file: ${path}`);
  if (!isSvgName(target.abs)) throw new FileToolError("Only .svg files can be read.");
  const info = await lstat(target.abs);
  if (info.size > MAX_READ_SVG_BYTES) {
    throw new FileToolError(
      `SVG is too large (${Math.round(info.size / 1024)} KB, the limit is ${MAX_READ_SVG_BYTES / 1024} KB).`,
    );
  }
  const svg = await readFile(target.abs, "utf8");
  return { path: target.rel, bytes: info.size, svg };
};
