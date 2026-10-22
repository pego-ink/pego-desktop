import { turnPrompt, type SessionTurn } from "./session-model";

/**
 * Memory of a session: earlier prompts and final replies, as compact text in front of the
 * current prompt. Same text for every backend (API, custom providers, local CLIs); the canvas is
 * live state the agent reads through tools, so no design is serialised here.
 */

export const HISTORY_LIMITS = {
  maxTurns: 8,
  /** Whole block, headers included. */
  maxChars: 6000,
  maxPromptChars: 600,
  maxReplyChars: 1200,
  /** An older turn is squeezed into the leftover budget only if at least this much fits. */
  minReplyChars: 120,
} as const;

const HEADER = "Earlier in this session (oldest first):";

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

const oneBlock = (text: string): string => text.replace(/\n{3,}/g, "\n\n").trim();

/** The turn's final reply; failed or cancelled runs without text say so. */
export const turnReply = (turn: SessionTurn): string => {
  const reply = turn.log.findLast((entry) => entry.kind === "assistant")?.text.trim();
  if (reply) return oneBlock(reply);
  if (turn.status === "failed") return "(the run failed)";
  if (turn.status === "cancelled") return "(the run was cancelled)";
  return "(no reply)";
};

/**
 * "Earlier in this session…" block, or "" when there is nothing to remember. Takes the last
 * `maxTurns` turns, then fills the character budget newest-first, so older turns lose text
 * (reply first) before newer ones and the oldest are dropped when nothing fits.
 */
export const buildHistoryBlock = (
  turns: readonly SessionTurn[],
  limits: typeof HISTORY_LIMITS = HISTORY_LIMITS,
): string => {
  const recent = turns.filter((turn) => turnPrompt(turn)).slice(-limits.maxTurns);
  let budget = limits.maxChars - HEADER.length - 1;
  const kept: string[] = [];
  for (const turn of recent.toReversed()) {
    const user = `User: ${clip(oneBlock(turnPrompt(turn)), limits.maxPromptChars)}`;
    const reply = clip(turnReply(turn), limits.maxReplyChars);
    const full = `${user}\nPego: ${reply}`;
    if (full.length + 1 <= budget) {
      kept.push(full);
      budget -= full.length + 1;
      continue;
    }
    // Squeeze this turn's reply into what is left; stop at the first turn that cannot fit.
    const room = budget - user.length - "\nPego: ".length - 1;
    if (room < limits.minReplyChars && kept.length > 0) break;
    kept.push(`${user}\nPego: ${clip(reply, Math.max(room, 0))}`);
    break;
  }
  if (kept.length === 0) return "";
  return `${HEADER}\n${kept.toReversed().join("\n")}`;
};

/** The prompt as the model sees it: history block (if any), then the current request. */
export const promptWithHistory = (prompt: string, history: string | undefined): string =>
  history ? `${history}\n\nCurrent request:\n${prompt}` : prompt;
