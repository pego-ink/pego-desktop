import { isAbsolute, relative, sep } from "node:path";

/**
 * Pure parts of "move a project folder to the OS Trash": which folders qualify, how the trashed
 * copy is named, the Freedesktop `.trashinfo` file and the commands per OS. The fs and spawn
 * calls live in trash.ts.
 */

/** True when `dir` is a direct child of `root` (both already resolved with realpath). */
export const isDirectChild = (root: string, dir: string): boolean => {
  const rel = relative(root, dir);
  return (
    rel !== "" && rel !== ".." && !rel.includes(sep) && !isAbsolute(rel) && !rel.startsWith("..")
  );
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYYMMDD-HHMMSS` in local time, appended to a name that already exists in the Trash. */
export const timestampSuffix = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

/**
 * The name for the trashed folder: `name` when free, else `name <timestamp>` (and `name
 * <timestamp> 2`, ... if even that is taken).
 */
export const trashName = (
  name: string,
  taken: (candidate: string) => boolean,
  now: Date,
): string => {
  if (!taken(name)) return name;
  const stamped = `${name} ${timestampSuffix(now)}`;
  if (!taken(stamped)) return stamped;
  for (let n = 2; ; n++) if (!taken(`${stamped} ${n}`)) return `${stamped} ${n}`;
};

/** Percent-encode a path for `.trashinfo` (RFC 3986 unreserved characters and `/` stay). */
export const encodeTrashPath = (path: string): string =>
  path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");

/** Content of `Trash/info/<name>.trashinfo` (XDG Trash spec; DeletionDate in local time). */
export const trashInfoContent = (originalPath: string, deletedAt: Date): string =>
  `[Trash Info]\nPath=${encodeTrashPath(originalPath)}\nDeletionDate=${deletedAt.getFullYear()}-${pad(deletedAt.getMonth() + 1)}-${pad(deletedAt.getDate())}T${pad(deletedAt.getHours())}:${pad(deletedAt.getMinutes())}:${pad(deletedAt.getSeconds())}\n`;

export type TrashCommand = { cmd: string[]; env: Record<string, string> };

/** Env var carrying the path to PowerShell, so it is never interpolated into the script. */
export const WINDOWS_TRASH_ENV = "PEGO_TRASH_PATH";

const WINDOWS_SCRIPT = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:${WINDOWS_TRASH_ENV}, 'OnlyErrorDialogs', 'SendToRecycleBin')`;

/** The external command that trashes `path` on this OS; null where the bridge moves it itself. */
export const trashCommand = (platform: NodeJS.Platform, path: string): TrashCommand | null => {
  if (platform === "win32") {
    return {
      cmd: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT],
      env: { [WINDOWS_TRASH_ENV]: path },
    };
  }
  if (platform === "linux") return { cmd: ["gio", "trash", "--", path], env: {} };
  return null;
};
