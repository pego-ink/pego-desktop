import type Anthropic from "@anthropic-ai/sdk";
import type { RunAttachment } from "@pego/agent";

/** Run-side helpers for images the user attached in the composer. */

/** "att-1", "att-2"…: one past the highest number in use, so ids are never reused while pending. */
export const nextAttachmentId = (existing: readonly { id: string }[]): string => {
  const highest = existing.reduce((max, item) => {
    const match = /^att-(\d+)$/.exec(item.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `att-${highest + 1}`;
};

export const attachmentDataUrl = (attachment: Pick<RunAttachment, "mediaType" | "data">): string =>
  `data:${attachment.mediaType};base64,${attachment.data}`;

/** The `place_image` source for an attachment id. */
export const attachmentSrc = (id: string): string => `attachment:${id}`;

const quoted = (name: string) => JSON.stringify(name);

/**
 * One line telling the model the images exist, what they are called and how to put one on the
 * canvas. Empty without attachments.
 */
export const attachmentNote = (attachments: readonly RunAttachment[]): string =>
  attachments.length === 0
    ? ""
    : `The user attached ${attachments.length === 1 ? "an image" : `${attachments.length} images`}: ` +
      `${attachments.map((a) => `${a.id} (${quoted(a.name)})`).join(", ")}. ` +
      `Pass src "attachment:<id>" to place_image to put one on the canvas.`;

/** Anthropic image blocks, one per attachment. Standard `/v1/messages` shape (also for compat). */
export const anthropicImageBlocks = (
  attachments: readonly RunAttachment[],
): Anthropic.Beta.BetaImageBlockParam[] =>
  attachments.map((a) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: a.mediaType, data: a.data },
  }));

/**
 * User message content for the Anthropic API: images first, then the text. A plain string when
 * there are no attachments, so text-only requests stay byte-identical to before.
 */
export const anthropicUserContent = (
  text: string,
  attachments: readonly RunAttachment[],
): string | Anthropic.Beta.BetaContentBlockParam[] => {
  if (attachments.length === 0) return text;
  const note = attachmentNote(attachments);
  return [
    ...anthropicImageBlocks(attachments),
    { type: "text" as const, text: note ? `${note}\n\n${text}` : text },
  ];
};

export type OpenAiImagePart = { type: "image_url"; image_url: { url: string } };

/** OpenAI-compatible `image_url` parts (data URLs). */
export const openAiImageParts = (attachments: readonly RunAttachment[]): OpenAiImagePart[] =>
  attachments.map((a) => ({ type: "image_url", image_url: { url: attachmentDataUrl(a) } }));

/** Lookup for the tool host: a data: URL and name, or undefined for an unknown id. */
export const findAttachmentSrc = (
  attachments: readonly RunAttachment[],
  id: string,
): { src: string; name: string } | undefined => {
  const found = attachments.find((a) => a.id === id);
  return found ? { src: attachmentDataUrl(found), name: found.name } : undefined;
};
