import type { RunAttachment, RunAttachmentType } from "@pego/agent";

/** Smallest byte strings that carry each type's magic bytes (enough for validation tests). */
const HEADERS: Record<RunAttachmentType, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0],
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0],
  "image/gif": [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
};

export const imageBytes = (mediaType: RunAttachmentType, extra = 0): Buffer =>
  Buffer.concat([Buffer.from(HEADERS[mediaType]), Buffer.alloc(extra)]);

export const makeAttachment = (
  id = "att-1",
  mediaType: RunAttachmentType = "image/png",
  overrides: Partial<RunAttachment> = {},
): RunAttachment => ({
  id,
  name: "ref.png",
  mediaType,
  data: imageBytes(mediaType, 16).toString("base64"),
  ...overrides,
});
