import type { ComposerNode } from "@/panels/agent/mentions/composer-doc";

/**
 * What was typed in each chat's composer and not sent yet, so switching chats keeps it. Kept in
 * memory only (like an unsent message in a chat app): a reload starts empty.
 */
const drafts = new Map<string, ComposerNode>();

export const saveDraft = (sessionId: string, content: ComposerNode | null): void => {
  if (content) drafts.set(sessionId, content);
  else drafts.delete(sessionId);
};

export const takeDraft = (sessionId: string): ComposerNode | null => drafts.get(sessionId) ?? null;
