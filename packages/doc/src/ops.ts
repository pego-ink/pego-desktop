import { z } from "zod";
import {
  nodeSchema,
  variableSchema,
  type PegoDocument,
  type PegoNode,
  type Variables,
} from "./schema";
import {
  childrenPath,
  collectDocIds,
  collectIds,
  findLocation,
  isContainer,
  isSelfOrDescendant,
  updateChildrenAt,
  type NodeLocation,
} from "./tree";

/** `parentId: null` targets the document root. */
const parentId = z.string().min(1).nullable();

export const insertOpSchema = z.object({
  op: z.literal("insert"),
  parentId,
  index: z.number().int().nonnegative().optional(),
  node: nodeSchema,
});
export const updateOpSchema = z.object({
  op: z.literal("update"),
  id: z.string().min(1),
  /** Partial node props to merge. `null` removes the prop. `id`, `type` and `children` are not allowed. */
  props: z.record(z.string(), z.unknown()),
});
export const replaceOpSchema = z.object({
  op: z.literal("replace"),
  id: z.string().min(1),
  node: nodeSchema,
});
export const moveOpSchema = z.object({
  op: z.literal("move"),
  id: z.string().min(1),
  parentId,
  index: z.number().int().nonnegative().optional(),
});
export const deleteOpSchema = z.object({
  op: z.literal("delete"),
  id: z.string().min(1),
});
export const setVariablesOpSchema = z.object({
  op: z.literal("setVariables"),
  /** Variables to set, keyed by name without `$`. `null` removes the variable. */
  variables: z.record(z.string(), variableSchema.nullable()),
});

export const opSchema = z.discriminatedUnion("op", [
  insertOpSchema,
  updateOpSchema,
  replaceOpSchema,
  moveOpSchema,
  deleteOpSchema,
  setVariablesOpSchema,
]);

export type Op = z.infer<typeof opSchema>;
export type OpKind = Op["op"];
export type InsertOp = z.infer<typeof insertOpSchema>;
export type UpdateOp = z.infer<typeof updateOpSchema>;
export type ReplaceOp = z.infer<typeof replaceOpSchema>;
export type MoveOp = z.infer<typeof moveOpSchema>;
export type DeleteOp = z.infer<typeof deleteOpSchema>;
export type SetVariablesOp = z.infer<typeof setVariablesOpSchema>;

export type OpErrorCode =
  | "node_not_found"
  | "parent_not_found"
  | "parent_not_container"
  | "duplicate_id"
  | "invalid_props"
  | "cycle"
  | "invalid_parent"
  | "last_page";

/** Thrown when an op cannot apply to the document. `code` is stable for agents and UI. */
export class OpError extends Error {
  readonly code: OpErrorCode;

  constructor(code: OpErrorCode, message: string) {
    super(message);
    this.name = "OpError";
    this.code = code;
  }
}

const FORBIDDEN_UPDATE_KEYS = new Set(["id", "type", "children"]);

const locate = (doc: PegoDocument, id: string): NodeLocation => {
  const loc = findLocation(doc, id);
  if (!loc) throw new OpError("node_not_found", `node "${id}" not found`);
  return loc;
};

const locateChildren = (doc: PegoDocument, parentId: string | null): number[] => {
  const path = childrenPath(doc, parentId);
  if (path) return path;
  if (parentId !== null && findLocation(doc, parentId)) {
    throw new OpError("parent_not_container", `node "${parentId}" cannot have children`);
  }
  throw new OpError("parent_not_found", `parent "${parentId}" not found`);
};

/** Fails when `node`'s subtree repeats an id or reuses one already in `taken`. */
const assertFreshIds = (node: PegoNode, taken: Set<string>): void => {
  const seen = new Set<string>();
  const walk = (n: PegoNode): void => {
    if (seen.has(n.id) || taken.has(n.id)) {
      throw new OpError("duplicate_id", `id "${n.id}" already exists`);
    }
    seen.add(n.id);
    if (isContainer(n)) n.children.forEach(walk);
  };
  walk(node);
};

const clampIndex = (index: number | undefined, length: number): number =>
  index === undefined ? length : Math.min(index, length);

const parentPathOf = (loc: NodeLocation): number[] => loc.path.slice(0, -1);

const setAt = (doc: PegoDocument, loc: NodeLocation, node: PegoNode): PegoDocument =>
  updateChildrenAt(doc, parentPathOf(loc), (children) =>
    children.map((child, i) => (i === loc.index ? node : child)),
  );

const removeAt = (doc: PegoDocument, loc: NodeLocation): PegoDocument =>
  updateChildrenAt(doc, parentPathOf(loc), (children) =>
    children.filter((_, i) => i !== loc.index),
  );

const insertAt = (
  doc: PegoDocument,
  parentId: string | null,
  index: number | undefined,
  node: PegoNode,
): PegoDocument =>
  updateChildrenAt(doc, locateChildren(doc, parentId), (children) => {
    const next = children.slice();
    next.splice(clampIndex(index, children.length), 0, node);
    return next;
  });

/** Merge props into a node and re-validate it. Children are kept as-is and not re-parsed. */
const mergeProps = (node: PegoNode, props: Record<string, unknown>): PegoNode => {
  const merged: Record<string, unknown> = { ...node };
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_UPDATE_KEYS.has(key)) {
      throw new OpError("invalid_props", `"${key}" cannot be updated`);
    }
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  if (isContainer(node)) merged.children = [];

  const parsed = nodeSchema.safeParse(merged);
  if (!parsed.success) {
    throw new OpError("invalid_props", `invalid props for "${node.id}": ${parsed.error.message}`);
  }
  return isContainer(node)
    ? ({ ...parsed.data, children: node.children } as PegoNode)
    : parsed.data;
};

const setVariables = (
  variables: Variables,
  changes: Record<string, Variables[string] | null>,
): Variables => {
  const next = { ...variables };
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
};

/** Pages live at the document root and nothing else does. */
const assertPlacement = (node: PegoNode, parentId: string | null): void => {
  if ((node.type === "page") === (parentId === null)) return;
  throw new OpError(
    "invalid_parent",
    node.type === "page"
      ? `page "${node.id}" can only sit at the document root (parentId null)`
      : `"${node.id}" must go inside a page, frame or group, not the document root`,
  );
};

/** Apply an op, returning a new document (never mutates). Throws `OpError` when the op does not fit the document. */
export const applyOp = (doc: PegoDocument, op: Op): PegoDocument => {
  switch (op.op) {
    case "insert": {
      assertPlacement(op.node, op.parentId);
      locateChildren(doc, op.parentId);
      assertFreshIds(op.node, collectDocIds(doc));
      return insertAt(doc, op.parentId, op.index, op.node);
    }
    case "update": {
      const loc = locate(doc, op.id);
      return setAt(doc, loc, mergeProps(loc.node, op.props));
    }
    case "replace": {
      const loc = locate(doc, op.id);
      assertPlacement(op.node, loc.parentId);
      const taken = collectDocIds(doc);
      for (const id of collectIds(loc.node)) taken.delete(id);
      assertFreshIds(op.node, taken);
      return setAt(doc, loc, op.node);
    }
    case "move": {
      const loc = locate(doc, op.id);
      assertPlacement(loc.node, op.parentId);
      locateChildren(doc, op.parentId);
      if (op.parentId !== null && isSelfOrDescendant(doc, op.id, op.parentId)) {
        throw new OpError("cycle", `cannot move "${op.id}" into itself or its descendant`);
      }
      return insertAt(removeAt(doc, loc), op.parentId, op.index, loc.node);
    }
    case "delete": {
      const loc = locate(doc, op.id);
      if (loc.node.type === "page" && doc.children.length === 1) {
        throw new OpError("last_page", "a document needs at least one page");
      }
      return removeAt(doc, loc);
    }
    case "setVariables":
      return { ...doc, variables: setVariables(doc.variables, op.variables) };
  }
};

/** Build the op that undoes `op`. `doc` is the document *before* `op` is applied. */
export const invertOp = (doc: PegoDocument, op: Op): Op => {
  switch (op.op) {
    case "insert":
      return { op: "delete", id: op.node.id };
    case "update": {
      const node: Record<string, unknown> = locate(doc, op.id).node;
      const props = Object.fromEntries(
        Object.keys(op.props).map((key) => [key, node[key] ?? null]),
      );
      return { op: "update", id: op.id, props };
    }
    case "replace":
      return { op: "replace", id: op.node.id, node: locate(doc, op.id).node };
    case "move": {
      const loc = locate(doc, op.id);
      return { op: "move", id: op.id, parentId: loc.parentId, index: loc.index };
    }
    case "delete": {
      const loc = locate(doc, op.id);
      return { op: "insert", parentId: loc.parentId, index: loc.index, node: loc.node };
    }
    case "setVariables": {
      const variables = Object.fromEntries(
        Object.keys(op.variables).map((name) => [name, doc.variables[name] ?? null]),
      );
      return { op: "setVariables", variables };
    }
  }
};

/**
 * Editors and tools speak of `parentId: null` as the top level of the canvas. Content lives on
 * pages, so an insert or move of anything but a page with a null parent goes to `pageId`.
 * Page ops (and every other op) pass through unchanged.
 */
export const placeOnPage = (doc: PegoDocument, op: Op, pageId: string): Op => {
  if (op.op === "insert" && op.parentId === null && op.node.type !== "page") {
    return { ...op, parentId: pageId };
  }
  if (op.op === "move" && op.parentId === null && findLocation(doc, op.id)?.node.type !== "page") {
    return { ...op, parentId: pageId };
  }
  return op;
};

/**
 * Apply ops in order, all or nothing. `inverse` undoes the whole batch when applied
 * to the returned document (it is already in reverse order).
 */
export const applyOps = (
  doc: PegoDocument,
  ops: readonly Op[],
): { doc: PegoDocument; inverse: Op[] } => {
  const inverse: Op[] = [];
  let current = doc;
  for (const op of ops) {
    inverse.unshift(invertOp(current, op));
    current = applyOp(current, op);
  }
  return { doc: current, inverse };
};
