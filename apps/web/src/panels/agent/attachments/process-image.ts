import { RUN_ATTACHMENT_LIMITS, type RunAttachment } from "@pego/agent";
import {
  downscaleSize,
  isAttachmentType,
  planEncoding,
  REENCODE_QUALITY,
  sniffImageType,
  type Size,
} from "./attachment-utils";

export type AttachmentErrorCode = "type" | "size" | "unreadable";

export class AttachmentError extends Error {
  constructor(readonly code: AttachmentErrorCode) {
    super(`attachment ${code}`);
    this.name = "AttachmentError";
  }
}

const MAX_NAME_LENGTH = 120;
/** Second attempt for an image that is still over the byte limit after the first re-encode. */
const FALLBACK_QUALITY = 0.7;

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(blob);
  });

const encode = async (
  bitmap: ImageBitmap,
  size: Size,
  type: string,
  quality: number,
): Promise<Blob | null> => {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
};

const decode = async (file: File): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new AttachmentError("unreadable");
  }
};

/**
 * Turn a picked, pasted or dropped file into a run attachment: the real type is sniffed from the
 * bytes, the image is decoded (so a renamed non-image fails), and big images are downscaled so
 * the longest side is at most 2048 px. A GIF keeps only its first frame. Throws AttachmentError.
 */
export const processImageFile = async (file: File): Promise<Omit<RunAttachment, "id">> => {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const source = sniffImageType(head);
  if (!source) throw new AttachmentError("type");

  const bitmap = await decode(file);
  try {
    const natural = { width: bitmap.width, height: bitmap.height };
    const plan = planEncoding(source, natural, file.size);
    const name = (file.name || "image").trim().slice(0, MAX_NAME_LENGTH) || "image";
    if (!plan.reencode) {
      return { name, mediaType: source, data: await toBase64(file), ...natural };
    }

    const size = downscaleSize(natural);
    let blob = await encode(bitmap, size, plan.type, REENCODE_QUALITY);
    if (blob && blob.size > RUN_ATTACHMENT_LIMITS.maxBytes) {
      blob = await encode(bitmap, size, plan.type, FALLBACK_QUALITY);
    }
    if (!blob) throw new AttachmentError("unreadable");
    // Safari cannot encode webp and answers png; anything unlisted would be rejected downstream.
    if (!isAttachmentType(blob.type)) throw new AttachmentError("unreadable");
    if (blob.size > RUN_ATTACHMENT_LIMITS.maxBytes) throw new AttachmentError("size");
    return { name, mediaType: blob.type, data: await toBase64(blob), ...size };
  } finally {
    bitmap.close();
  }
};
