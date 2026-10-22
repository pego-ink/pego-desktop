import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunAttachment, RunAttachmentType } from "@pego/agent";

/** Directory (inside the run's workdir) the attachments are written to. */
export const ATTACHMENTS_DIR = "attachments";

const ID_PATTERN = /^att-\d{1,6}$/;
const MAX_NAME_LENGTH = 80;

/** File extension per media type; the only source of an attachment's extension. */
const EXTENSIONS: Record<RunAttachmentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const attachmentExtension = (mediaType: RunAttachmentType): string => EXTENSIONS[mediaType];

/** An attachment as an adapter sees it: the validated payload plus where it lives on disk. */
export type AgentAttachment = RunAttachment & {
  /** Absolute path of the file in the run's workdir. */
  path: string;
  /** Path relative to the workdir (`attachments/<id>.<ext>`), what `@file` references use. */
  relativePath: string;
};

/**
 * Display name for an attachment: path segments dropped, control characters and anything that
 * could look like markup or an `@file` reference removed, length capped. Never used as a path.
 */
export const sanitizeAttachmentName = (raw: string): string => {
  const base = raw.split(/[\\/]/).at(-1) ?? "";
  const cleaned = [...base]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && !"@<>\"'`$|;&*?{}[]()#%^~!=+,:".includes(char);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const capped = cleaned.slice(0, MAX_NAME_LENGTH).trim();
  return capped === "" ? "image" : capped;
};

/** First 12 bytes of a base64 payload (16 base64 characters). */
const headBytes = (data: string): Uint8Array =>
  Uint8Array.from(Buffer.from(data.slice(0, 16), "base64"));

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((value, index) => bytes[offset + index] === value);

/** Does the (base64) payload begin with the magic bytes of `mediaType`? */
export const hasImageSignature = (mediaType: RunAttachmentType, data: string): boolean => {
  const head = headBytes(data);
  switch (mediaType) {
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(head, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return (
        startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)
      );
  }
};

/**
 * Write the attachments into `<workdir>/attachments/<id>.<ext>`. The file name is built from the
 * validated id and the extension of the media type only, so `name` can never influence a path.
 * Files are created exclusively (no overwrite, no following symlinks) and owner-only.
 */
export const writeAttachments = async (
  workdir: string,
  attachments: readonly RunAttachment[],
): Promise<AgentAttachment[]> => {
  if (attachments.length === 0) return [];
  if (!attachments.every((item) => ID_PATTERN.test(item.id)))
    throw new Error("invalid attachment id");
  const dir = join(workdir, ATTACHMENTS_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const written: AgentAttachment[] = [];
  for (const attachment of attachments) {
    const relativePath = `${ATTACHMENTS_DIR}/${attachment.id}.${attachmentExtension(attachment.mediaType)}`;
    const path = join(workdir, relativePath);
    await writeFile(path, Buffer.from(attachment.data, "base64"), { flag: "wx", mode: 0o600 });
    written.push({ ...attachment, path, relativePath });
  }
  return written;
};

/** One line for every adapter's prompt: which ids exist and how to put one on the canvas. */
export const attachmentPromptNote = (attachments: readonly RunAttachment[]): string =>
  attachments.length === 0
    ? ""
    : `\n\nThe user attached ${attachments.length} image${attachments.length === 1 ? "" : "s"}: ${attachments
        .map((item) => `${item.id} (${item.name})`)
        .join(", ")}. To put one on the canvas, call place_image with src "attachment:<id>".`;

/**
 * `@file` references (Gemini CLI, Qwen Code) appended to a prompt, one per attachment, relative to
 * the workdir. Both CLIs inline the image themselves; their read tools stay disabled.
 */
export const withAtFileReferences = (
  prompt: string,
  attachments: readonly Pick<AgentAttachment, "relativePath">[] = [],
): string =>
  attachments.length === 0
    ? prompt
    : `${prompt}\n\n${attachments.map((item) => `@${item.relativePath}`).join(" ")}`;
