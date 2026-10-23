import {
  mentionRefSchema,
  mentionToken,
  type MentionRef,
  type PromptWithMentions,
} from "@pego/agent";

/** The slice of a Tiptap JSON node the composer reads. */
export type ComposerNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ComposerNode[];
};

/** Node name of a mention chip in the composer document. */
export const MENTION_NODE = "mention";

/** A chip's ref, stored as JSON in the node's `ref` attribute; null when unreadable. */
export const readMentionRef = (attrs: Record<string, unknown> | undefined): MentionRef | null => {
  const raw = attrs?.ref;
  if (typeof raw !== "string") return null;
  try {
    const parsed = mentionRefSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * The composer document as a prompt: paragraphs and hard breaks become newlines, chips become
 * mention tokens (indexes into `mentions`). Unreadable chips are dropped.
 */
export const composerToPrompt = (doc: ComposerNode): PromptWithMentions => {
  const mentions: MentionRef[] = [];
  const inline = (node: ComposerNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === MENTION_NODE) {
      const ref = readMentionRef(node.attrs);
      if (!ref) return "";
      mentions.push(ref);
      return mentionToken(mentions.length - 1);
    }
    return (node.content ?? []).map(inline).join("");
  };
  const blocks = (doc.content ?? []).map(inline);
  return { text: blocks.join("\n").trim(), mentions };
};

/** Plain text (a seed or a prompt put back after a failed send) as composer content. */
export const textToComposer = (text: string): ComposerNode => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  })),
});
