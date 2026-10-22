import { RUN_ATTACHMENT_LIMITS, RUN_ATTACHMENT_TYPES, type RunAttachmentType } from "@pego/agent";

/** Pure helpers for composer attachments (validation, sizing, ids). No DOM access here. */

/** Longest side of a stored attachment; bigger images are re-encoded smaller. */
export const MAX_ATTACH_SIDE = 2048;
/** Quality for lossy re-encodes (webp/jpeg). */
export const REENCODE_QUALITY = 0.9;
/** Hard cap on the file we are willing to decode (the stored result must still fit the limit). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const ATTACH_ACCEPT = RUN_ATTACHMENT_TYPES.join(",");

const TYPES = new Set<string>(RUN_ATTACHMENT_TYPES);

export const isAttachmentType = (type: string): type is RunAttachmentType => TYPES.has(type);

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

/** The real image type from the leading bytes (a file's `type` comes from its extension). */
export const sniffImageType = (bytes: Uint8Array): RunAttachmentType | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
};

/** Decoded byte length of a base64 string. */
export const base64ByteLength = (data: string): number => {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
};

export type RejectReason = "type" | "input_too_large";

export type AdditionPlan<T> = {
  accepted: T[];
  rejected: { file: T; reason: RejectReason }[];
  /** Files dropped because the per-run count limit was reached. */
  overflow: number;
};

type FileLike = { type: string; size: number };

/**
 * Decide which of `files` to process: images of a supported type and sane size, as many as still
 * fit under the count limit (`existing` stored plus `inFlight` being processed).
 */
export const planAdditions = <T extends FileLike>(
  files: readonly T[],
  existing: number,
  inFlight = 0,
): AdditionPlan<T> => {
  const accepted: T[] = [];
  const rejected: AdditionPlan<T>["rejected"] = [];
  let overflow = 0;
  let room = Math.max(0, RUN_ATTACHMENT_LIMITS.maxCount - existing - inFlight);
  for (const file of files) {
    if (!isAttachmentType(file.type)) rejected.push({ file, reason: "type" });
    else if (file.size > MAX_INPUT_BYTES) rejected.push({ file, reason: "input_too_large" });
    else if (room <= 0) overflow += 1;
    else {
      accepted.push(file);
      room -= 1;
    }
  }
  return { accepted, rejected, overflow };
};

export type Size = { width: number; height: number };

/** `size` shrunk (never enlarged) so the longest side is at most `max`; whole pixels, >= 1. */
export const downscaleSize = (size: Size, max = MAX_ATTACH_SIDE): Size => {
  const longest = Math.max(size.width, size.height);
  const scale = longest > max ? max / longest : 1;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
};

/**
 * What to do with a decoded image: keep the file's bytes, or re-encode (too big in pixels or
 * bytes; a GIF always, because only its first frame is sent) and as which type.
 */
export type EncodePlan = { reencode: false } | { reencode: true; type: RunAttachmentType };

export const planEncoding = (
  source: RunAttachmentType,
  natural: Size,
  bytes: number,
): EncodePlan => {
  const target = downscaleSize(natural);
  const resized = target.width !== natural.width || target.height !== natural.height;
  const oversize = bytes > RUN_ATTACHMENT_LIMITS.maxBytes;
  if (source === "image/gif") {
    // Unscaled first frame stays lossless; a big one is re-encoded like any other bitmap.
    return { reencode: true, type: resized || oversize ? "image/webp" : "image/png" };
  }
  if (!resized && !oversize) return { reencode: false };
  return { reencode: true, type: source === "image/jpeg" ? "image/jpeg" : "image/webp" };
};

/**
 * Image files to take from a paste. Text on the clipboard wins: copying a spreadsheet range puts
 * a text table and a picture of it side by side, and pasting that as text is what people expect.
 */
export const pastedImageFiles = <T extends { type: string }>(
  files: readonly T[],
  types: readonly string[],
): T[] =>
  types.includes("text/plain") ? [] : files.filter((file) => file.type.startsWith("image/"));

export const isGifName = (name: string): boolean => /\.gif$/i.test(name);

/** Tooltip text for a thumbnail (the name, plus a note for GIFs). */
export const attachmentTitle = (name: string): string =>
  isGifName(name) ? `${name}\nAnimated GIF: only the first frame is sent.` : name;

const formatMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export const limitMessages = {
  count: `You can attach up to ${RUN_ATTACHMENT_LIMITS.maxCount} images per message.`,
  type: (name: string) => `${name} is not a supported image. Use PNG, JPEG, WebP or GIF.`,
  size: (name: string) =>
    `${name} is too large. Images can be up to ${formatMb(RUN_ATTACHMENT_LIMITS.maxBytes)} after resizing.`,
  unreadable: (name: string) => `${name} could not be read as an image.`,
  busy: "Wait for the agent to finish before attaching images.",
} as const;
