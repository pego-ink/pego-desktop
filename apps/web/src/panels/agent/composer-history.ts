import type { AgentLogEntry } from "@/agent/use-agent-store";
import { textToComposer, type ComposerNode } from "@/panels/agent/mentions/composer-doc";

/** How many sent messages a chat remembers for ↑ / ↓. */
const MAX_HISTORY = 50;

/** Messages this window sent, by chat: the text the log shows and the box exactly as typed. */
const sent = new Map<string, { text: string; doc: ComposerNode }[]>();

/** Remember a message the composer sent (`text` = its log text), so ↑ brings back its chips. */
export const recordSent = (sessionId: string, text: string, doc: ComposerNode): void => {
  const list = [...(sent.get(sessionId) ?? []), { text: text.trim(), doc }];
  sent.set(sessionId, list.slice(-MAX_HISTORY));
};

/**
 * The chat's earlier messages for ↑, oldest first: every user message in its log (typed here,
 * sent from the canvas, or restored after a reload), as typed when this window sent it, else as
 * plain text. Repeats in a row count once.
 */
export const historyFor = (sessionId: string, log: readonly AgentLogEntry[]): ComposerNode[] => {
  const own = sent.get(sessionId) ?? [];
  const texts = log
    .filter((entry) => entry.kind === "user" && entry.text.trim() !== "")
    .map((entry) => entry.text.trim())
    .filter((text, index, all) => text !== all[index - 1])
    .slice(-MAX_HISTORY);
  return texts.map(
    (text) => own.findLast((entry) => entry.text === text)?.doc ?? textToComposer(text),
  );
};

/** Where ↑ / ↓ is in the history: null while editing the draft, plus the draft to come back to. */
export type HistoryNav = { index: number | null; draft: ComposerNode | null };

export const NO_HISTORY_NAV: HistoryNav = { index: null, draft: null };

/**
 * One step through `entries` (-1 = older, ↑; 1 = newer, ↓): the new position and what the box
 * shows, or null when the key should do its normal thing (nothing older, or not in the history).
 * Going newer than the last message brings the draft back.
 */
export const stepHistory = (
  entries: readonly ComposerNode[],
  nav: HistoryNav,
  current: ComposerNode,
  direction: -1 | 1,
): { nav: HistoryNav; show: ComposerNode } | null => {
  if (direction === -1) {
    if (entries.length === 0) return null;
    if (nav.index === null) {
      const index = entries.length - 1;
      return { nav: { index, draft: current }, show: entries[index]! };
    }
    if (nav.index === 0) return null;
    const index = nav.index - 1;
    return { nav: { ...nav, index }, show: entries[index]! };
  }
  if (nav.index === null) return null;
  if (nav.index < entries.length - 1) {
    const index = nav.index + 1;
    return { nav: { ...nav, index }, show: entries[index]! };
  }
  return { nav: NO_HISTORY_NAV, show: nav.draft ?? textToComposer("") };
};
