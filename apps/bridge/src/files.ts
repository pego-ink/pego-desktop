import { randomUUID } from "node:crypto";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize } from "node:path";
import { MAX_DOCUMENT_FILE_BYTES } from "./config";

export class FileToolError extends Error {}

/**
 * Check a path the bridge is asked to read or write. Only absolute `.pego` paths are accepted, so
 * the file tools cannot be pointed at arbitrary files. Returns the normalized path.
 */
export const checkDocumentPath = (path: string, mode: "read" | "write"): string => {
  if (!isAbsolute(path)) {
    throw new FileToolError(`Use an absolute path (got "${path}").`);
  }
  const normalized = normalize(path);
  const extension = extname(normalized).toLowerCase();
  if (extension !== ".pego") {
    throw new FileToolError(
      mode === "write"
        ? `Pego only saves .pego files (got "${basename(normalized)}").`
        : `Pego only opens .pego files (got "${basename(normalized)}").`,
    );
  }
  return normalized;
};

export const readDocumentFile = async (path: string): Promise<string> => {
  const target = checkDocumentPath(path, "read");
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new FileToolError(`File not found: ${target}`);
  }
  if (!info.isFile()) throw new FileToolError(`Not a file: ${target}`);
  if (info.size > MAX_DOCUMENT_FILE_BYTES) {
    throw new FileToolError(`File is too large (${Math.round(info.size / 1024 / 1024)} MB).`);
  }
  return Bun.file(target).text();
};

/**
 * Write a .pego file atomically (temp file in the same folder, then rename), so a crash never
 * leaves a half-written design. The folder must already exist.
 */
export const writeDocumentFile = async (path: string, text: string): Promise<string> => {
  const target = checkDocumentPath(path, "write");
  if (Buffer.byteLength(text) > MAX_DOCUMENT_FILE_BYTES) {
    throw new FileToolError("Document is too large to save.");
  }
  const folder = dirname(target);
  try {
    if (!(await stat(folder)).isDirectory()) throw new Error();
  } catch {
    throw new FileToolError(`Folder does not exist: ${folder}`);
  }
  const temp = join(folder, `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw new FileToolError(
      `Could not write ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return target;
};
