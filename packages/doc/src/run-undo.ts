import { applyOps, type Op } from "./ops";
import type { History, Transaction } from "./history";
import type { PegoDocument, PegoNode } from "./schema";
import { collectIds, findLocation } from "./tree";

export type RunUndoPlan =
  | { ok: true; ops: Op[]; count: number; label: string }
  | { ok: false; reason: "nothing" | "conflict"; message: string };

export const RUN_UNDO_LABEL = "Undo agent changes";

const subtreeIds = (node: PegoNode, into: Set<string>): void => {
  for (const id of collectIds(node)) into.add(id);
};

/**
 * Collect ids an op names. `parents` controls whether parent containers (insert target,
 * move destination) count; they are "weak" touches and are left out of conflict checks so
 * two runs may add children to the same frame.
 */
const collectOpIds = (op: Op, into: Set<string>, parents: boolean): void => {
  switch (op.op) {
    case "insert":
      subtreeIds(op.node, into);
      if (parents && op.parentId) into.add(op.parentId);
      return;
    case "update":
    case "delete":
      into.add(op.id);
      return;
    case "replace":
      into.add(op.id);
      subtreeIds(op.node, into);
      return;
    case "move":
      into.add(op.id);
      if (parents && op.parentId) into.add(op.parentId);
      return;
    case "setVariables":
      return;
  }
};

/**
 * Node ids an op modifies. `doc` is the document before the op: it supplies the descendants
 * of a deleted/replaced subtree and the old parent of a moved node.
 */
export const opTouchedIds = (op: Op, doc: PegoDocument): string[] => {
  const ids = new Set<string>();
  collectOpIds(op, ids, true);
  if (op.op === "delete" || op.op === "replace" || op.op === "move") {
    const loc = findLocation(doc, op.id);
    if (loc) {
      if (op.op !== "move") subtreeIds(loc.node, ids);
      else if (loc.parentId) ids.add(loc.parentId);
    }
  }
  return [...ids];
};

/** Variable names a setVariables op writes. */
export const opTouchedVariables = (op: Op): string[] =>
  op.op === "setVariables" ? Object.keys(op.variables) : [];

type Touched = { ids: Set<string>; variables: Set<string> };

/**
 * Approximation: the doc state before each op is not replayed. Ids come from the transaction's
 * ops AND its inverse ops (an inverse insert carries the whole deleted subtree, an inverse move
 * names the old position). Parent containers are ignored, so only the nodes themselves conflict.
 */
const touchedBy = (transactions: readonly Transaction[]): Touched => {
  const touched: Touched = { ids: new Set(), variables: new Set() };
  for (const tx of transactions) {
    for (const op of [...tx.ops, ...tx.inverse]) {
      collectOpIds(op, touched.ids, false);
      for (const name of opTouchedVariables(op)) touched.variables.add(name);
    }
  }
  return touched;
};

const conflictWith = (tx: Transaction, run: Touched): string | null => {
  const other = touchedBy([tx]);
  const sharesLayers = [...other.ids].some((id) => run.ids.has(id));
  const sharesVariables = [...other.variables].some((name) => run.variables.has(name));
  if (!sharesLayers && !sharesVariables) return null;
  const what = sharesLayers ? "layers" : "variables";
  return `Later edit "${tx.label ?? "untitled"}" touched the same ${what}`;
};

/**
 * Plan a single transaction that reverts only the transactions of `runId`.
 * Refused when a later transaction from someone else touched the same nodes or variables.
 */
export const planRunUndo = (doc: PegoDocument, history: History, runId: string): RunUndoPlan => {
  const { past } = history;
  const first = past.findIndex((tx) => tx.runId === runId);
  if (first === -1) {
    return { ok: false, reason: "nothing", message: "This run has no changes to undo" };
  }
  const own = past.filter((tx) => tx.runId === runId);
  const run = touchedBy(own);

  for (const tx of past.slice(first + 1)) {
    if (tx.runId === runId) continue;
    const message = conflictWith(tx, run);
    if (message) return { ok: false, reason: "conflict", message };
  }

  const ops = own.toReversed().flatMap((tx) => tx.inverse);
  try {
    applyOps(doc, ops);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Changes no longer apply";
    return { ok: false, reason: "conflict", message };
  }
  return { ok: true, ops, count: own.length, label: RUN_UNDO_LABEL };
};
