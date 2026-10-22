import { applyOps, type Op } from "./ops";
import type { PegoDocument } from "./schema";

export type TransactionSource = "user" | "agent";

/** One undo step: a gesture, a panel edit, or one agent step. */
export type Transaction = {
  ops: Op[];
  inverse: Op[];
  label?: string;
  source: TransactionSource;
};

export type History = {
  past: Transaction[];
  future: Transaction[];
};

export const HISTORY_LIMIT = 200;

export const emptyHistory = (): History => ({ past: [], future: [] });

/** Apply ops as one transaction and record it. New edits clear the redo stack. */
export const commit = (
  doc: PegoDocument,
  history: History,
  ops: readonly Op[],
  meta: { source: TransactionSource; label?: string },
): { doc: PegoDocument; history: History; transaction: Transaction } => {
  const result = applyOps(doc, ops);
  const transaction: Transaction = { ops: [...ops], inverse: result.inverse, ...meta };
  const past = [...history.past, transaction].slice(-HISTORY_LIMIT);
  return { doc: result.doc, history: { past, future: [] }, transaction };
};

/**
 * Fold more ops into the latest transaction, e.g. each pointermove of a drag.
 * Its inverse still restores the state before the first op.
 */
export const extendLast = (
  doc: PegoDocument,
  history: History,
  ops: readonly Op[],
): { doc: PegoDocument; history: History } => {
  const last = history.past.at(-1);
  if (!last) throw new Error("no transaction to extend");
  const result = applyOps(doc, ops);
  const extended: Transaction = {
    ...last,
    ops: [...last.ops, ...ops],
    inverse: [...result.inverse, ...last.inverse],
  };
  return {
    doc: result.doc,
    history: { past: [...history.past.slice(0, -1), extended], future: [] },
  };
};

export const undo = (
  doc: PegoDocument,
  history: History,
): { doc: PegoDocument; history: History } | null => {
  const last = history.past.at(-1);
  if (!last) return null;
  return {
    doc: applyOps(doc, last.inverse).doc,
    history: { past: history.past.slice(0, -1), future: [last, ...history.future] },
  };
};

export const redo = (
  doc: PegoDocument,
  history: History,
): { doc: PegoDocument; history: History } | null => {
  const [next, ...rest] = history.future;
  if (!next) return null;
  return {
    doc: applyOps(doc, next.ops).doc,
    history: { past: [...history.past, next], future: rest },
  };
};
