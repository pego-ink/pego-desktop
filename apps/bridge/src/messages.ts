import { z } from "zod";
import type { EditorToBridge } from "@pego/agent";

const id = z.string().min(1).max(128);

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
