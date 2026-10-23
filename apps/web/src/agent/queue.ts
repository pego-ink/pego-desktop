import { MAX_CONCURRENT_RUNS, type RunAttachment } from "@pego/agent";
import { toast } from "sonner";
import { isRunActive } from "@/panels/agent/agent-format";
import { nextAttachmentId } from "./attachments";
import { sendToBridge } from "./bridge-client";
import { cancelRun, startRun } from "./run";
import { allRuns, runsForSession, startBlock } from "./run-registry";
import { useAgentStore, type QueuedMessage } from "./use-agent-store";

/**
 * Prompt queue and steer, per chat session.
 *
 * - `submitPrompt` is the one entry point for "the user sent a prompt into session X": it starts a
 *   run when the session is idle, otherwise appends to the session's queue (`SessionLive.queue`).
 * - When a run ends with "done" or "failed", the first queued message starts the next run
 *   (`advanceQueues`, driven by `startQueueDriver`). A run the user cancelled keeps its queue.
 * - Messages that wait for a free slot (`MAX_CONCURRENT_RUNS`) start when any run ends.
 * - `steerNow` / `steerQueued` push a message into the running agent; how depends on the backend.
 */

export type SubmitResult = "started" | "queued" | "refused";
export type SteerResult = "steered" | "started" | "queued" | "refused";

/** How a prompt is shown and which skills its mentions pick; `text` is what the agent receives. */
export type PromptDisplay = Pick<QueuedMessage, "displayText" | "parts" | "skillId" | "styleId">;

type SubmitOptions = PromptDisplay & { attachments?: RunAttachment[] };

/** What the queue reaches out to; tests replace these with fakes. */
export const queueDeps = { startRun, cancelRun, sendToBridge };

const agent = () => useAgentStore.getState();
const liveOf = (sessionId: string) => agent().liveSessions[sessionId];

/** Sessions whose queued messages wait for a free run slot, not for the session's own run. */
const waitingForSlot = new Set<string>();

const reportFailure = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : "Agent action failed");

const makeMessage = (
  text: string,
  attachments: RunAttachment[] = [],
  display: PromptDisplay = {},
): QueuedMessage => ({
  id: crypto.randomUUID(),
  text,
  ...(display.displayText?.trim() ? { displayText: display.displayText.trim() } : {}),
  ...(display.parts?.some((part) => part.kind === "mention") ? { parts: display.parts } : {}),
  ...(display.skillId ? { skillId: display.skillId } : {}),
  ...(display.styleId ? { styleId: display.styleId } : {}),
  attachments,
  createdAt: Date.now(),
});

const setQueue = (sessionId: string, update: (queue: QueuedMessage[]) => QueuedMessage[]) =>
  agent().patchSession(sessionId, (live) => ({ queue: update(live.queue) }));

const enqueue = (sessionId: string, message: QueuedMessage) =>
  setQueue(sessionId, (queue) => [...queue, message]);

/** Start a run for a message; the run registers synchronously, so the session is busy right away. */
const launch = (
  sessionId: string,
  message: Pick<QueuedMessage, "text" | "attachments"> & PromptDisplay,
  steered = false,
) => {
  waitingForSlot.delete(sessionId);
  // Always explicit: an undefined list would make startRun take the composer's pending images.
  void queueDeps
    .startRun(message.text, {
      sessionId,
      attachments: message.attachments,
      steered,
      displayText: message.displayText,
      parts: message.parts,
      skillId: message.skillId,
      styleId: message.styleId,
    })
    .catch(reportFailure);
};

/**
 * Send a prompt into a session. Starts a run now when the session has none and a slot is free;
 * otherwise the prompt is queued (behind the running one, or until a slot frees). "refused" only
 * for an empty prompt or a session that is not open.
 */
export const submitPrompt = (
  sessionId: string,
  text: string,
  options: SubmitOptions = {},
): SubmitResult => {
  const trimmed = text.trim();
  if (!trimmed || !liveOf(sessionId)) return "refused";
  const message = makeMessage(trimmed, options.attachments ?? [], options);
  const block = startBlock(allRuns(), sessionId);
  if (!block) {
    launch(sessionId, message);
    return "started";
  }
  enqueue(sessionId, message);
  if (block.reason === "too_many_runs") waitingForSlot.add(sessionId);
  return "queued";
};

export const removeQueued = (sessionId: string, id: string): void => {
  setQueue(sessionId, (queue) => queue.filter((message) => message.id !== id));
};

/** Replace the text of a queued message. False for an empty text or an unknown message. */
export const editQueued = (sessionId: string, id: string, text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || !liveOf(sessionId)?.queue.some((message) => message.id === id)) return false;
  setQueue(sessionId, (queue) =>
    queue.map((message) => {
      if (message.id !== id) return message;
      // An edit replaces what the agent gets too; the context prefix and chips go with the old
      // text (skills picked by mentions stay: the edited text still names them).
      return { ...message, text: trimmed, displayText: undefined, parts: undefined };
    }),
  );
  return true;
};

/** Resolves once `sessionId` has no run left (a cancelled in-browser run ends asynchronously). */
const untilSessionFree = (sessionId: string, timeoutMs = 5000): Promise<boolean> =>
  new Promise((resolve) => {
    const free = () => runsForSession(sessionId).length === 0;
    if (free()) return resolve(true);
    const finish = (value: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(free()), timeoutMs);
    const unsubscribe = useAgentStore.subscribe(() => {
      if (free()) finish(true);
    });
  });

/** Give each steer image an id no image of the run uses yet (the run's tool host reads the list). */
const adoptAttachments = (
  known: RunAttachment[] | undefined,
  attachments: readonly RunAttachment[],
): RunAttachment[] =>
  attachments.map((attachment) => {
    if (!known) return attachment;
    const adopted = { ...attachment, id: nextAttachmentId(known) };
    known.push(adopted);
    return adopted;
  });

/**
 * Push a message into the session's running agent now.
 * - In-browser runtimes (Anthropic API, custom providers): the next model turn of the run reads it.
 * - Local CLI with `steer: "native"` (Claude Code): sent as `run_steer`; its bubble reads "Sending…"
 *   until the bridge reports `steered`.
 * - Other local CLIs: the run is cancelled and a new run starts in the same session with this
 *   message (the session history rides along; canvas changes stay).
 * With no run in the session it behaves like `submitPrompt`. `display` is how the bubble shows the
 * message (a run that restarts for it also takes its mention skills).
 */
export const steerNow = (
  sessionId: string,
  text: string,
  attachments: RunAttachment[] = [],
  display: PromptDisplay = {},
): SteerResult => {
  const trimmed = text.trim();
  if (!trimmed || !liveOf(sessionId)) return "refused";
  const run = runsForSession(sessionId)[0];
  if (!run) return submitPrompt(sessionId, trimmed, { ...display, attachments });

  const parts = display.parts?.some((part) => part.kind === "mention") ? display.parts : undefined;
  const logSteer = (shown: RunAttachment[]) =>
    agent().appendLog(sessionId, {
      kind: "user",
      text: display.displayText?.trim() || trimmed,
      steered: "pending",
      ...(parts ? { parts } : {}),
      ...(shown.length > 0 ? { attachments: shown } : {}),
    });

  if (run.steerInbox) {
    const adopted = adoptAttachments(run.attachments, attachments);
    run.steerInbox.push({ id: logSteer(adopted), text: trimmed, attachments: adopted });
    return "steered";
  }

  if (run.backend === "local" && run.steerMode === "native") {
    const id = logSteer(attachments);
    const sent = queueDeps.sendToBridge({
      type: "run_steer",
      runId: run.id,
      text: trimmed,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    if (!sent) agent().setSteered(sessionId, id, "failed");
    return "steered";
  }

  void restartWith(sessionId, run.id, trimmed, attachments, display);
  return "steered";
};

/** Cancel the run, wait for it to end, then start a new run in the same session with `text`. */
const restartWith = async (
  sessionId: string,
  runId: string,
  text: string,
  attachments: RunAttachment[],
  display: PromptDisplay,
): Promise<void> => {
  queueDeps.cancelRun(runId);
  if (!(await untilSessionFree(sessionId))) {
    // The old run would not stop: keep the message rather than losing it.
    enqueue(sessionId, makeMessage(text, attachments, display));
    return;
  }
  if (!liveOf(sessionId)) return;
  const block = startBlock(allRuns(), sessionId);
  if (block) {
    enqueue(sessionId, makeMessage(text, attachments, display));
    if (block.reason === "too_many_runs") waitingForSlot.add(sessionId);
    return;
  }
  launch(sessionId, { ...display, text, attachments }, true);
};

/** Take a queued message out of the queue and steer the running agent with it. */
export const steerQueued = (sessionId: string, id: string): SteerResult => {
  const message = liveOf(sessionId)?.queue.find((item) => item.id === id);
  if (!message) return "refused";
  removeQueued(sessionId, id);
  const result = steerNow(sessionId, message.text, message.attachments, message);
  // Nothing took it (empty text cannot happen here): put it back where it was.
  if (result === "refused") enqueue(sessionId, message);
  return result;
};

/** Whether a session's queue should start its first message now. */
const readyToAdvance = (sessionId: string): boolean => {
  const live = liveOf(sessionId);
  if (!live || live.queue.length === 0) return false;
  if (runsForSession(sessionId).length > 0 || isRunActive(live.status)) return false;
  // A run the user cancelled keeps its queue; only a finished or failed one moves on.
  return live.status === "done" || live.status === "failed" || waitingForSlot.has(sessionId);
};

/**
 * Start the first queued message of every session that is ready, while run slots are free. Safe to
 * call at any time (idempotent); the queue driver calls it after every store change that matters.
 */
export const advanceQueues = (): void => {
  for (const sessionId of Object.keys(agent().liveSessions)) {
    if (allRuns().length >= MAX_CONCURRENT_RUNS) return;
    if (!readyToAdvance(sessionId)) continue;
    const [first] = liveOf(sessionId)!.queue;
    if (!first) continue;
    removeQueued(sessionId, first.id);
    launch(sessionId, first);
  }
};

/**
 * Advance queues whenever a run ends. A run's status flips just before its registry entry goes
 * away, so the check runs on the next tick. Returns the cleanup.
 */
export const startQueueDriver = (): (() => void) => {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      advanceQueues();
    }, 0);
  };
  const unsubscribe = useAgentStore.subscribe((state, prev) => {
    if (state.liveSessions !== prev.liveSessions) schedule();
  });
  return unsubscribe;
};

/** Forget in-memory slot waiters (tests, and a fresh editor). */
export const resetQueueState = (): void => {
  waitingForSlot.clear();
};
