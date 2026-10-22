import { z } from "zod";
import {
  LOCAL_AGENT_IDS,
  RUN_ATTACHMENT_LIMITS,
  RUN_ATTACHMENT_TYPES,
  type EditorToBridge,
} from "@pego/agent";
import { hasImageSignature, sanitizeAttachmentName } from "./attachments";
import { MAX_DOCUMENT_FILE_BYTES } from "./config";

const id = z.string().min(1).max(128);
const agentId = z.enum(LOCAL_AGENT_IDS);
/** Model ids pass through to the CLI unchanged; just keep them printable and never flag-like. */
const isSafeModelId = (value: string): boolean =>
  !value.startsWith("-") &&
  [...value].every((char) => {
    const code = char.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
const modelId = z.string().min(1).max(200).refine(isSafeModelId, "invalid model id");

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

const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil((RUN_ATTACHMENT_LIMITS.maxBytes * 4) / 3) + 4;
const MAX_PROMPT_CHARS = 100_000;
const MAX_STEER_CHARS = 20_000;

const attachmentSchema = z
  .object({
    id: z.string().regex(/^att-\d{1,6}$/),
    name: z.string().max(1024).transform(sanitizeAttachmentName),
    mediaType: z.enum(RUN_ATTACHMENT_TYPES),
    data: z
      .string()
      .min(4)
      .max(MAX_ATTACHMENT_BASE64_LENGTH)
      .refine((data) => data.length % 4 === 0 && BASE64.test(data), "invalid base64")
      .refine((data) => decodedBytes(data) <= RUN_ATTACHMENT_LIMITS.maxBytes, "image too large"),
    width: z.number().int().positive().max(MAX_IMAGE_DIMENSION).optional(),
    height: z.number().int().positive().max(MAX_IMAGE_DIMENSION).optional(),
  })
  // The bytes must be the image type the editor claims (CLIs sniff content, not our label).
  .refine((attachment) => hasImageSignature(attachment.mediaType, attachment.data), {
    message: "image data does not match its type",
  });

const attachmentsSchema = z
  .array(attachmentSchema)
  .max(RUN_ATTACHMENT_LIMITS.maxCount)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "duplicate id");

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
  z.object({
    type: z.literal("run_start"),
    runId: id,
    prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
    agentId,
    model: modelId.optional(),
    attachments: attachmentsSchema.optional(),
  }),
  z.object({ type: z.literal("focus") }),
  z.object({ type: z.literal("agents_refresh") }),
  z.object({ type: z.literal("models_request"), agentId }),
  z.object({ type: z.literal("run_cancel"), runId: id }),
  z.object({
    type: z.literal("run_steer"),
    runId: id,
    text: z.string().min(1).max(MAX_STEER_CHARS),
    attachments: attachmentsSchema.optional(),
  }),
  z.object({
    type: z.literal("project_request"),
    requestId: id,
    action: z.enum(["list", "read", "projects", "create_project"]),
    path: z.string().min(1).max(4096).optional(),
    name: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("save_file"),
    requestId: id,
    path: z.string().min(1).max(4096),
    text: z.string().max(MAX_DOCUMENT_FILE_BYTES),
  }),
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
