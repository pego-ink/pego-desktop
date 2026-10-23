import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DomSnapshot, ExtensionCapture } from "@pego/agent";

/**
 * The Pego browser extension (apps/extension) sends captures to POST /extension/import. Only a
 * browser extension may (its origin is chrome-extension:// or moz-extension://), and only with
 * the pairing code: a random secret the bridge keeps in ~/.pego/extension-token (owner-only) and
 * shows to the editor (GET /extension/token, editor origin only), where the user copies it into
 * the extension once. Any other extension or page cannot push content onto the canvas.
 */
export const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_TOKEN_PATH = join(homedir(), ".pego", "extension-token");
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

/** The pairing code, created (owner-only file) on first use. */
export const loadExtensionToken = async (path = DEFAULT_TOKEN_PATH): Promise<string> => {
  try {
    const saved = (await readFile(path, "utf8")).trim();
    if (TOKEN_PATTERN.test(saved)) return saved;
  } catch {
    // Not created yet.
  }
  const token = randomBytes(24).toString("hex");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return token;
};

/** True for a browser extension's origin. */
export const isExtensionOrigin = (origin: string | null): boolean =>
  origin !== null && /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin);

/** Constant-time comparison of the sent pairing code with the real one. */
export const tokenMatches = (sent: string | null, token: string): boolean => {
  if (!sent) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  // Compare byte lengths: a multi-byte character makes them differ from the string lengths.
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
};

/** The request body as text, or null when it is over `max` bytes (chunked bodies included). */
export const readTextLimited = async (request: Request, max: number): Promise<string | null> => {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pageOf = (value: unknown): { url: string; title: string } | null => {
  if (!isRecord(value) || typeof value.url !== "string" || !/^https?:\/\//i.test(value.url)) {
    return null;
  }
  return {
    url: value.url.slice(0, 2000),
    title: typeof value.title === "string" ? value.title.slice(0, 300) : "",
  };
};

/** The capture in a request body, checked for shape (the editor validates the content). */
export const parseCapture = (body: unknown): ExtensionCapture | null => {
  if (!isRecord(body)) return null;
  const page = pageOf(body.page);
  if (!page) return null;
  if (body.kind === "snapshot") {
    const snapshot = body.snapshot;
    if (!isRecord(snapshot) || !isRecord(snapshot.root)) return null;
    return {
      kind: "snapshot",
      page,
      fullPage: body.fullPage === true,
      // Its content is the editor's to validate (the DOM converter checks every node).
      snapshot: snapshot as unknown as DomSnapshot,
    };
  }
  if (body.kind === "screenshot") {
    const { dataUrl, width, height } = body;
    if (typeof dataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
      return null;
    }
    if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
      return null;
    }
    return { kind: "screenshot", page, dataUrl, width, height };
  }
  return null;
};
