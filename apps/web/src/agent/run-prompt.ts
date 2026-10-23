import {
  mentionContext,
  mentionedSkills,
  promptParts,
  promptPartsText,
  promptTextForAgent,
  resolveMentions,
  withMentionContext,
  type MentionScope,
  type PromptPart,
  type PromptWithMentions,
} from "@pego/agent";
import type { PegoDocument } from "@pego/doc";
import { useBrowserStore } from "@/browser/use-browser-store";

/** Everything a run needs from the user's prompt, the same for every backend. */
export type RunPrompt = {
  /** The request in the user's words, mentions as readable labels with ids. */
  requestText: string;
  /** The context block: the app state, then the layers, components and images mentioned. */
  context: string;
  /** What the model receives: the context block, then `Request: <requestText>`. */
  agentText: string;
  /** The prompt as the log shows it: text and chips. */
  parts: PromptPart[];
  /** `parts` as plain text ("@Label" for chips). */
  displayText: string;
  /** Skill and style picked by mentions (they fill the skill chip's one-run slots). */
  skillId?: string;
  styleId?: string;
};

/**
 * Turn a prompt with mentions into the texts a run uses: `agentText` goes to `submitPrompt`, the
 * rest to the bubble and the run's skills. Mentions whose targets are gone are dropped first.
 * `appState` (see app-state.ts) goes first in the context block.
 */
export const buildRunPrompt = (
  doc: PegoDocument,
  prompt: PromptWithMentions,
  scope: MentionScope = {},
  appState = "",
): RunPrompt => {
  // Browser mentions of a page the browser has left since are stale (`scope` may override).
  const mentionScope: MentionScope = { browserUrl: useBrowserStore.getState().state.url, ...scope };
  const context = [appState, mentionContext(doc, prompt.mentions, mentionScope)]
    .filter(Boolean)
    .join("\n\n");
  const requestText = promptTextForAgent(doc, prompt, mentionScope);
  const parts = promptParts(doc, prompt, scope);
  return {
    requestText,
    context,
    agentText: withMentionContext(requestText, context),
    parts,
    displayText: promptPartsText(parts),
    ...mentionedSkills(resolveMentions(doc, prompt.mentions, mentionScope)),
  };
};
