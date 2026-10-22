import type { RunAttachment } from "@pego/agent";
import { attachmentNote } from "./attachments";

/** A message the user sent into a running in-browser agent, waiting for its next turn boundary. */
export type SteerMessage = {
  /** Id of the transcript bubble that shows it. */
  id: string;
  text: string;
  /** Images, with ids already unique within the run. */
  attachments: RunAttachment[];
};

/**
 * Per-run mailbox for steer messages. The runtime drains it between model turns; a message that
 * was drained stays in `delivered()` so later steps (which start from a fresh prompt) still see it.
 */
export type SteerInbox = {
  push: (message: SteerMessage) => void;
  /** Take every pending message (oldest first) and mark it delivered. */
  drain: () => SteerMessage[];
  /** Take every pending message without delivering it (the run ended first). */
  takePending: () => SteerMessage[];
  pending: () => number;
  /** Everything delivered so far, oldest first. */
  delivered: () => readonly SteerMessage[];
};

export const createSteerInbox = (onDelivered?: (message: SteerMessage) => void): SteerInbox => {
  let queue: SteerMessage[] = [];
  const done: SteerMessage[] = [];
  return {
    push: (message) => {
      queue.push(message);
    },
    drain: () => {
      const taken = queue;
      queue = [];
      for (const message of taken) {
        done.push(message);
        onDelivered?.(message);
      }
      return taken;
    },
    takePending: () => {
      const taken = queue;
      queue = [];
      return taken;
    },
    pending: () => queue.length,
    delivered: () => done,
  };
};

/** What the model reads for steer messages (images travel as separate content blocks). */
export const steerText = (messages: readonly SteerMessage[]): string =>
  [
    "The user sent a new message while you were working. Take it into account and change course if it asks for that:",
    ...messages.map((message) => {
      const note = attachmentNote(message.attachments);
      return note ? `${note}\n\n${message.text}` : message.text;
    }),
  ].join("\n\n");

/** Images of several steer messages, in order. */
export const steerImages = (messages: readonly SteerMessage[]): RunAttachment[] =>
  messages.flatMap((message) => message.attachments);
