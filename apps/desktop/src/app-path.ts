import { extname, join, normalize, sep } from "node:path";
import { stat } from "node:fs/promises";

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

/**
 * Map a request pathname to a file inside `root`. Returns null for anything that escapes the
 * root. Extension-less paths fall back to index.html (SPA routing).
 */
export const resolveAppFile = async (root: string, pathname: string): Promise<string | null> => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = normalize(decoded).replace(/^[/\\]+/, "");
  const target = join(root, relative === "" ? "index.html" : relative);
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (await isFile(target)) return target;
  if (extname(target) === "") return join(root, "index.html");
  return null;
};
