import { z } from "zod";
import {
  applyOp,
  cloneWithFreshIds,
  collectDocIds,
  findLocation,
  nodeSchema,
  OpError,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { assignIds, idTree, parseNode, ToolError, type CreatedNode } from "../tool-kit";
import {
  assertNoCycle,
  checkRefs,
  instanceRootProps,
  requireComponent,
  validateOverrides,
} from "./components";

export const MAX_BATCH_OPERATIONS = 200;

const id = z.string().min(1);
/** A node id, or "@alias" for a node created earlier in the same batch. */
const ref = id;
const parent = id.nullable();
const index = z.number().int().nonnegative();
const alias = z.string().regex(/^@?[A-Za-z_][\w-]*$/, "alias must look like name or @name");
const props = z.record(z.string(), z.unknown());

const insertOperation = z.strictObject({
  op: z.literal("insert"),
  parent,
  index: index.optional(),
  node: z.unknown(),
  as: alias.optional(),
});
const updateOperation = z.strictObject({ op: z.literal("update"), target: ref, props });
const replaceOperation = z.strictObject({
  op: z.literal("replace"),
  target: ref,
  node: z.unknown(),
  as: alias.optional(),
});
const moveOperation = z.strictObject({
  op: z.literal("move"),
  target: ref,
  parent,
  index: index.optional(),
});
const deleteOperation = z.strictObject({ op: z.literal("delete"), target: ref });
const copyOperation = z.strictObject({
  op: z.literal("copy"),
  source: ref,
  parent,
  index: index.optional(),
  overrides: props.optional(),
  as: alias.optional(),
});
const instanceOperation = z.strictObject({
  op: z.literal("instance"),
  component: ref,
  parent,
  index: index.optional(),
  props: props.optional(),
  overrides: z.record(z.string(), props).optional(),
  as: alias.optional(),
});

export const batchSchema = z.strictObject({
  operations: z
    .array(
      z.discriminatedUnion("op", [
        insertOperation,
        updateOperation,
        replaceOperation,
        moveOperation,
        deleteOperation,
        copyOperation,
        instanceOperation,
      ]),
    )
    .min(1)
    .max(MAX_BATCH_OPERATIONS),
});

export type BatchOperation = z.infer<typeof batchSchema>["operations"][number];

export type BatchCreated = { operation: number; alias?: string } & CreatedNode;

export type BatchResult = {
  ops: Op[];
  doc: PegoDocument;
  aliases: Record<string, string>;
  created: BatchCreated[];
  warnings: string[];
  focus: string[];
};

const stripAt = (name: string): string => (name.startsWith("@") ? name.slice(1) : name);

const UNKNOWN_ALIAS_HINT =
  "An @alias exists only after an earlier operation of the same call defined it with `as` (insert, replace, copy or instance). Put the defining operation first, or use a real id.";

/** Resolve "@alias" to the id it was given; plain ids pass through. */
const resolveRef = (value: string, aliases: Map<string, string>): string => {
  if (!value.startsWith("@")) return value;
  const found = aliases.get(stripAt(value));
  if (found) return found;
  throw new ToolError(
    "unknown_alias",
    `alias "${value}" is not defined by an earlier operation`,
    UNKNOWN_ALIAS_HINT,
  );
};

const resolveParent = (value: string | null, aliases: Map<string, string>): string | null =>
  value === null ? null : resolveRef(value, aliases);

/** Replace "@alias" in `ref` nodes anywhere in a raw node tree. */
const resolveNodeRefs = (raw: unknown, aliases: Map<string, string>): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const node = raw as Record<string, unknown>;
  return {
    ...node,
    ...(node.type === "ref" && typeof node.ref === "string"
      ? { ref: resolveRef(node.ref, aliases) }
      : {}),
    ...(Array.isArray(node.children)
      ? { children: node.children.map((child) => resolveNodeRefs(child, aliases)) }
      : {}),
  };
};

const describe = (operation: BatchOperation): string => {
  const as = "as" in operation && operation.as ? ` as @${stripAt(operation.as)}` : "";
  return `${operation.op}${as}`;
};

const withContext = (error: unknown, position: number, label: string): never => {
  const prefix = `operation ${position} (${label}): `;
  const suffix = " Nothing was applied.";
  if (error instanceof OpError) throw new OpError(error.code, prefix + error.message + suffix);
  if (error instanceof ToolError) {
    throw new ToolError(error.code, prefix + error.message + suffix, error.hint);
  }
  throw error;
};

/** Merge root props into a copied node and re-validate it (null removes a prop). */
const mergeRootProps = (node: PegoNode, overrides: Record<string, unknown>): PegoNode => {
  const forbidden = Object.keys(overrides).filter((key) =>
    ["id", "type", "children"].includes(key),
  );
  if (forbidden.length > 0) {
    throw new ToolError("invalid_props", `overrides cannot set ${forbidden.join(", ")}`);
  }
  const merged: Record<string, unknown> = { ...node };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const parsed = nodeSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ToolError(
      "invalid_props",
      `invalid overrides for the copy: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
};

type State = {
  doc: PegoDocument;
  taken: Set<string>;
  aliases: Map<string, string>;
  ops: Op[];
  created: BatchCreated[];
  warnings: string[];
  focus: Set<string>;
};

const defineAlias = (
  state: State,
  name: string | undefined,
  nodeId: string,
): string | undefined => {
  if (!name) return undefined;
  const key = stripAt(name);
  if (state.aliases.has(key)) {
    throw new ToolError(
      "duplicate_alias",
      `alias "@${key}" is already used by an earlier operation`,
      "Give every created node its own alias.",
    );
  }
  state.aliases.set(key, nodeId);
  return key;
};

const push = (state: State, op: Op): void => {
  if (op.op === "insert" || op.op === "replace") checkRefs(state.doc, op.node);
  state.doc = applyOp(state.doc, op);
  state.ops.push(op);
};

/** Index-after-delete safe focus: parents of deleted nodes, created/updated/moved nodes. */
const noteCreated = (
  state: State,
  position: number,
  node: PegoNode,
  aliasName: string | undefined,
): void => {
  state.created.push({
    operation: position,
    ...(aliasName ? { alias: aliasName } : {}),
    ...idTree(node),
  });
  state.focus.add(node.id);
};

const runOperation = (state: State, operation: BatchOperation, position: number): void => {
  const { aliases } = state;
  switch (operation.op) {
    case "insert": {
      const parentId = resolveParent(operation.parent, aliases);
      const raw = assignIds(resolveNodeRefs(operation.node, aliases), state.taken);
      const { node, ignored } = parseNode(raw, "node");
      state.warnings.push(...ignored.map((path) => `operation ${position}: ignored prop ${path}`));
      const aliasName = defineAlias(state, operation.as, node.id);
      push(state, {
        op: "insert",
        parentId,
        ...(operation.index === undefined ? {} : { index: operation.index }),
        node,
      });
      noteCreated(state, position, node, aliasName);
      return;
    }
    case "update": {
      const target = resolveRef(operation.target, aliases);
      push(state, { op: "update", id: target, props: operation.props });
      state.focus.add(target);
      return;
    }
    case "replace": {
      const target = resolveRef(operation.target, aliases);
      const raw = assignIds(resolveNodeRefs(operation.node, aliases), state.taken, target);
      const { node, ignored } = parseNode(raw, "node");
      state.warnings.push(...ignored.map((path) => `operation ${position}: ignored prop ${path}`));
      const aliasName = defineAlias(state, operation.as, node.id);
      push(state, { op: "replace", id: target, node });
      noteCreated(state, position, node, aliasName);
      return;
    }
    case "move": {
      const target = resolveRef(operation.target, aliases);
      push(state, {
        op: "move",
        id: target,
        parentId: resolveParent(operation.parent, aliases),
        ...(operation.index === undefined ? {} : { index: operation.index }),
      });
      state.focus.add(target);
      return;
    }
    case "delete": {
      const target = resolveRef(operation.target, aliases);
      const parentId = findLocation(state.doc, target)?.parentId;
      push(state, { op: "delete", id: target });
      if (parentId) state.focus.add(parentId);
      return;
    }
    case "copy": {
      const source = resolveRef(operation.source, aliases);
      const original = findLocation(state.doc, source)?.node;
      if (!original) {
        throw new OpError("node_not_found", `node "${source}" not found`);
      }
      const copy = cloneWithFreshIds(original);
      const node = operation.overrides ? mergeRootProps(copy, operation.overrides) : copy;
      const aliasName = defineAlias(state, operation.as, node.id);
      push(state, {
        op: "insert",
        parentId: resolveParent(operation.parent, aliases),
        ...(operation.index === undefined ? {} : { index: operation.index }),
        node,
      });
      noteCreated(state, position, node, aliasName);
      return;
    }
    case "instance": {
      const componentId = resolveRef(operation.component, aliases);
      const parentId = resolveParent(operation.parent, aliases);
      requireComponent(state.doc, componentId);
      assertNoCycle(state.doc, componentId, parentId);
      if (operation.overrides) validateOverrides(state.doc, componentId, operation.overrides);
      const raw = {
        ...instanceRootProps(operation.props ?? {}),
        type: "ref",
        id: freshRefId(state),
        ref: componentId,
        ...(operation.overrides && Object.keys(operation.overrides).length > 0
          ? { descendants: operation.overrides }
          : {}),
      };
      const { node, ignored } = parseNode(raw, "props");
      state.warnings.push(...ignored.map((path) => `operation ${position}: ignored prop ${path}`));
      const aliasName = defineAlias(state, operation.as, node.id);
      push(state, {
        op: "insert",
        parentId,
        ...(operation.index === undefined ? {} : { index: operation.index }),
        node,
      });
      noteCreated(state, position, node, aliasName);
      return;
    }
  }
};

const freshRefId = (state: State): string => {
  const node = assignIds({ type: "ref" }, state.taken) as { id: string };
  return node.id;
};

/**
 * Resolve aliases, validate and dry-run every operation against a working copy of the document.
 * Throws on the first failure (naming the operation); the host is never touched here, so a failed
 * batch changes nothing.
 */
export const buildBatch = (
  doc: PegoDocument,
  operations: readonly BatchOperation[],
): BatchResult => {
  const state: State = {
    doc,
    taken: collectDocIds(doc),
    aliases: new Map(),
    ops: [],
    created: [],
    warnings: [],
    focus: new Set(),
  };
  operations.forEach((operation, position) => {
    try {
      runOperation(state, operation, position);
    } catch (error) {
      withContext(error, position, describe(operation));
    }
  });
  const focus = [...state.focus].filter((nodeId) => findLocation(state.doc, nodeId) !== null);
  return {
    ops: state.ops,
    doc: state.doc,
    aliases: Object.fromEntries(state.aliases),
    created: state.created,
    warnings: state.warnings,
    focus,
  };
};
