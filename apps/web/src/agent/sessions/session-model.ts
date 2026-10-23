import type { PromptPart, RunAttachment } from "@pego/agent";
import type { AgentLogEntry, RunStatus } from "@/agent/use-agent-store";

/**
 * Chat sessions of the Agent panel: pure types and helpers (no store, no IndexedDB). A session is
 * an ordered list of turns; a turn is one agent run (user prompt, activity log, reply, usage).
 */

export type TurnUsage = { inputTokens: number; outputTokens: number; costUsd: number };

export type SessionTurn = {
  runId: string;
  /** Final status; a run that was still active when the turn was captured counts as cancelled. */
  status: RunStatus;
  runLabel: string | null;
  log: AgentLogEntry[];
  usage: TurnUsage;
};

/** A message typed while the session's run was busy, waiting for the next run (or a steer). */
export type QueuedMessage = {
  id: string;
  text: string;
  /** What the chip and, once run, the user bubble show instead of `text` (which the agent gets). */
  displayText?: string;
  /** The prompt with its mention chips, for the chip and the user bubble. */
  parts?: PromptPart[];
  /** Skill and style picked by mentions (one run, like the skill chip). */
  skillId?: string;
  styleId?: string;
  attachments: RunAttachment[];
  /** Name and size of images the message had before a reload (the image data is gone). */
  attachmentsMeta?: AttachmentMeta[];
  createdAt: number;
};

/** Everything the panel needs of one session, live or restored. */
export type SessionState = {
  id: string;
  createdAt: number;
  /** Explicit user rename; null = derive the title from the first prompt. */
  customTitle: string | null;
  turns: SessionTurn[];
  /** Messages waiting for the next run; absent = none. */
  queue?: QueuedMessage[];
};

/** Lightweight attachment record: the image data is never stored. */
export type AttachmentMeta = { name: string; size: number };

export type StoredLogEntry = Omit<AgentLogEntry, "attachments"> & {
  attachments?: AttachmentMeta[];
};
export type StoredTurn = Omit<SessionTurn, "log"> & { log: StoredLogEntry[] };
export type StoredQueuedMessage = {
  id: string;
  text: string;
  displayText?: string;
  parts?: PromptPart[];
  skillId?: string;
  styleId?: string;
  createdAt: number;
  attachments: AttachmentMeta[];
};

/** The IndexedDB record ("pego-sessions"). Holds no API keys and no image data. */
export type StoredSession = {
  id: string;
  /** `doc.id` of the design file this chat belongs to. */
  docId: string;
  title: string;
  /** True when `title` was typed by the user (otherwise derived from the first prompt). */
  titleCustom: boolean;
  createdAt: number;
  updatedAt: number;
  turns: StoredTurn[];
  /** Queued messages; their images are stored as name and size only. */
  queue?: StoredQueuedMessage[];
};

export type SessionMeta = { id: string; title: string; updatedAt: number };

export const SESSION_LIMITS = {
  /** Sessions kept per design file; the oldest beyond this are pruned. */
  maxPerDoc: 50,
  /** Turns kept per session (a safety net against unbounded growth). */
  maxTurns: 40,
  titleChars: 40,
} as const;

export const EMPTY_TITLE = "New chat";

const ACTIVE: readonly RunStatus[] = ["planning", "running", "awaiting_decision"];

/** The user's own first prompt of a turn (later `user` entries are decision answers). */
export const turnPrompt = (turn: Pick<SessionTurn, "log">): string =>
  turn.log.find((entry) => entry.kind === "user")?.text ?? "";

/** First prompt on one line, cut at `max` characters with an ellipsis. */
export const titleFromPrompt = (
  prompt: string,
  max: number = SESSION_LIMITS.titleChars,
): string => {
  const line = prompt.replace(/\s+/g, " ").trim();
  if (!line) return EMPTY_TITLE;
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
};

export const sessionTitle = (session: Pick<SessionState, "customTitle" | "turns">): string => {
  if (session.customTitle) return session.customTitle;
  const first = session.turns.find((turn) => turnPrompt(turn));
  return first ? titleFromPrompt(turnPrompt(first)) : EMPTY_TITLE;
};

/** A run that never reported an end (reload mid-run) is stored as cancelled, not stuck "running". */
export const settleStatus = (status: RunStatus): RunStatus =>
  ACTIVE.includes(status) ? "cancelled" : status;

const attachmentMeta = (attachments: readonly RunAttachment[]): AttachmentMeta[] =>
  // Base64 is 4 chars per 3 bytes (padding ignored; this is only a size hint).
  attachments.map((a) => ({ name: a.name, size: Math.floor((a.data.length * 3) / 4) }));

const stripEntry = (entry: AgentLogEntry): StoredLogEntry => {
  const { attachments, ...rest } = entry;
  return attachments?.length ? { ...rest, attachments: attachmentMeta(attachments) } : rest;
};

/** Metadata of the attachments of a restored entry (their image data is gone). */
export const entryAttachmentMeta = (entry: AgentLogEntry): AttachmentMeta[] =>
  entry.attachmentsMeta ?? [];

const restoreEntry = (entry: StoredLogEntry): AgentLogEntry => {
  const { attachments, ...rest } = entry;
  return attachments?.length ? { ...rest, attachmentsMeta: attachments } : rest;
};

/** The optional mention fields of a queued message, copied only when set. */
const mentionFields = (message: Pick<QueuedMessage, "parts" | "skillId" | "styleId">) => ({
  ...(message.parts ? { parts: message.parts } : {}),
  ...(message.skillId ? { skillId: message.skillId } : {}),
  ...(message.styleId ? { styleId: message.styleId } : {}),
});

const stripQueued = (message: QueuedMessage): StoredQueuedMessage => ({
  id: message.id,
  text: message.text,
  ...(message.displayText ? { displayText: message.displayText } : {}),
  ...mentionFields(message),
  createdAt: message.createdAt,
  attachments:
    message.attachments.length > 0
      ? attachmentMeta(message.attachments)
      : (message.attachmentsMeta ?? []),
});

const restoreQueued = (message: StoredQueuedMessage): QueuedMessage => ({
  id: message.id,
  text: message.text,
  ...(message.displayText ? { displayText: message.displayText } : {}),
  ...mentionFields(message),
  createdAt: message.createdAt,
  attachments: [],
  ...(message.attachments.length > 0 ? { attachmentsMeta: message.attachments } : {}),
});

export const toStoredSession = (
  session: SessionState,
  docId: string,
  updatedAt: number,
): StoredSession => {
  const turns = session.turns.slice(-SESSION_LIMITS.maxTurns).map((turn) => ({
    ...turn,
    status: settleStatus(turn.status),
    log: turn.log.map(stripEntry),
  }));
  return {
    id: session.id,
    docId,
    title: sessionTitle(session),
    titleCustom: session.customTitle !== null,
    createdAt: session.createdAt,
    updatedAt,
    turns,
    ...(session.queue?.length ? { queue: session.queue.map(stripQueued) } : {}),
  };
};

export const fromStoredSession = (stored: StoredSession): SessionState => ({
  id: stored.id,
  createdAt: stored.createdAt,
  customTitle: stored.titleCustom ? stored.title : null,
  turns: stored.turns.map((turn) => ({
    ...turn,
    status: settleStatus(turn.status),
    log: turn.log.map(restoreEntry),
  })),
  ...(stored.queue?.length ? { queue: stored.queue.map(restoreQueued) } : {}),
});

export const metaOf = (stored: StoredSession): SessionMeta => ({
  id: stored.id,
  title: stored.title,
  updatedAt: stored.updatedAt,
});

/** Newest first. */
export const sortMetas = (metas: readonly SessionMeta[]): SessionMeta[] =>
  [...metas].sort((a, b) => b.updatedAt - a.updatedAt);

/** Ids to delete so that only the newest `max` sessions remain. */
export const prunedIds = (
  metas: readonly SessionMeta[],
  max: number = SESSION_LIMITS.maxPerDoc,
): string[] =>
  sortMetas(metas)
    .slice(max)
    .map((meta) => meta.id);

export const emptySession = (id: string = crypto.randomUUID(), now = Date.now()): SessionState => ({
  id,
  createdAt: now,
  customTitle: null,
  turns: [],
});
