import { z } from "zod";
import type { EditorToBridge } from "@pego/agent";

const id = z.string().min(1).max(128);

/** Limits for screenshots attached to a `tool_result`. */
export const MAX_IMAGES_PER_RESULT = 4;
export const MAX_IMAGE_BYTES_PER_RESULT = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 32_768;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const decodedBytes = (data: string): number => {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
};

const imageSchema = z.object({
  mediaType: z.literal("image/png"),
  data: z
    .string()
    .min(4)
    .max(Math.ceil((MAX_IMAGE_BYTES_PER_RESULT * 4) / 3) + 4)
    .refine((data) => data.length % 4 === 0 && BASE64.test(data), "invalid base64"),
  width: z.number().int().positive().max(MAX_IMAGE_DIMENSION),
  height: z.number().int().positive().max(MAX_IMAGE_DIMENSION),
});

const imagesSchema = z
  .array(imageSchema)
  .max(MAX_IMAGES_PER_RESULT)
  .refine(
    (images) =>
      images.reduce((sum, image) => sum + decodedBytes(image.data), 0) <=
      MAX_IMAGE_BYTES_PER_RESULT,
    "images too large",
  );

/** Runtime validation of every frame the editor sends. Mirrors `EditorToBridge`. */
export const editorMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int(),
    documentName: z.string().max(512),
  }),
  z.object({
    type: z.literal("tool_result"),
    callId: id,
    content: z.string(),
    isError: z.boolean(),
    images: imagesSchema.optional(),
  }),
  z.object({ type: z.literal("run_start"), runId: id, prompt: z.string().min(1).max(100_000) }),
  z.object({ type: z.literal("run_cancel"), runId: id }),
]) satisfies z.ZodType<EditorToBridge>;

export type ParseResult = { ok: true; message: EditorToBridge } | { ok: false; error: string };

export const parseEditorMessage = (raw: string | Buffer): ParseResult => {
  if (typeof raw !== "string") return { ok: false, error: "binary frames are not supported" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const parsed = editorMessageSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "invalid message shape" };
  return { ok: true, message: parsed.data };
};
