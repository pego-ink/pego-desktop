import { z } from "zod";
import {
  applyOp,
  createId,
  findLocation,
  isContainer,
  nodeSchema,
  OpError,
  pageOrFirst,
  placeOnPage,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import type { JsonSchema, ToolHost, ToolResult, ToolSpec } from "./types";

/** An error with a stable code and a hint the model can act on. */
export class ToolError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.hint = hint;
  }
}

export const ok = (data: unknown): ToolResult => ({
  content: JSON.stringify(data),
  isError: false,
});

/** A plain-text result: documents and guides read better (and cost fewer tokens) unescaped. */
export const okText = (content: string): ToolResult => ({ content, isError: false });

export const fail = (code: string, message: string, hint?: string): ToolResult => ({
  content: JSON.stringify({ error: { code, message, ...(hint ? { hint } : {}) } }),
  isError: true,
});

const OP_ERROR_HINTS: Record<string, string> = {
  node_not_found:
    "Call get_document to see the current ids. Ids inside a component instance (like a/b) cannot be edited directly: change the ref node's descendants or edit the component itself.",
  parent_not_found:
    "Call get_document to find a valid parent id, or pass null for the document root.",
  parent_not_container:
    "Only frame and group nodes can have children. Insert into a frame instead.",
  duplicate_id: "Omit id on new nodes to get generated ones, or pick an id that is not used yet.",
  invalid_props:
    "Check the prop names and value types for this node type (call get_node to see its current props). Colors are hex or $variable, sizes are pixels, fill_container or fit_content.",
  cycle: "A node cannot move into itself or one of its descendants. Choose a different parent.",
};

export const formatZodError = (error: z.ZodError): string =>
  error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`)
    .join("; ");

export const toFailure = (error: unknown): ToolResult => {
  if (error instanceof ToolError) return fail(error.code, error.message, error.hint);
  if (error instanceof OpError) return fail(error.code, error.message, OP_ERROR_HINTS[error.code]);
  return fail("internal_error", error instanceof Error ? error.message : String(error));
};

type ToolDefinition<S extends z.ZodType> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  schema: S;
  /** Shown with validation errors so the model can fix the call. */
  inputHint: string;
  run: (input: z.infer<S>, host: ToolHost) => Promise<ToolResult> | ToolResult;
};

/** Validate input with zod, run, and turn every failure into an `isError` result. */
export const defineTool = <S extends z.ZodType>(def: ToolDefinition<S>): ToolSpec => ({
  name: def.name,
  description: def.description,
  inputSchema: def.inputSchema,
  run: async (input, host) => {
    const parsed = def.schema.safeParse(input ?? {});
    if (!parsed.success) return fail("invalid_input", formatZodError(parsed.error), def.inputHint);
    try {
      return await def.run(parsed.data, host);
    } catch (error) {
      return toFailure(error);
    }
  },
});

// --- ids ---------------------------------------------------------------------

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectSuppliedIds = (raw: unknown, into: Set<string>): void => {
  if (!isRaw(raw)) return;
  if (typeof raw.id === "string" && raw.id) into.add(raw.id);
  if (Array.isArray(raw.children)) raw.children.forEach((child) => collectSuppliedIds(child, into));
};

const freshId = (taken: Set<string>): string => {
  let id = createId();
  while (taken.has(id)) id = createId();
  taken.add(id);
  return id;
};

const fillIds = (raw: unknown, taken: Set<string>, rootId?: string): unknown => {
  if (!isRaw(raw)) return raw;
  const hasId = typeof raw.id === "string" && raw.id;
  const id = hasId ? raw.id : (rootId ?? freshId(taken));
  const children = Array.isArray(raw.children)
    ? { children: raw.children.map((child) => fillIds(child, taken)) }
    : {};
  return { ...raw, ...children, id };
};

/**
 * Give every node without an id a generated one. `taken` should hold the ids already in the
 * document; supplied ids are reserved first so generated ones never collide with them.
 * `rootId` is used for the root when it has no id (replace keeps the target id).
 */
export const assignIds = (raw: unknown, taken: Set<string>, rootId?: string): unknown => {
  collectSuppliedIds(raw, taken);
  return fillIds(raw, taken, rootId);
};

// --- node validation -----------------------------------------------------------

/** Paths of props present in `raw` but dropped by the schema (unknown or misplaced props). */
const droppedProps = (raw: unknown, parsed: unknown, path: string, into: string[]): string[] => {
  if (!isRaw(raw) || !isRaw(parsed)) return into;
  for (const key of Object.keys(raw)) {
    if (!(key in parsed)) into.push(`${path}.${key}`);
  }
  if (Array.isArray(raw.children) && Array.isArray(parsed.children)) {
    raw.children.forEach((child, i) =>
      droppedProps(
        child,
        parsed.children && (parsed.children as unknown[])[i],
        `${path}.children[${i}]`,
        into,
      ),
    );
  }
  return into;
};

export const NODE_HINT =
  "Node format: {type, id?, name?, ...props, children?}. type is frame | group | rectangle | ellipse | path | text | icon | ref. Only frame and group take children. Colors are hex or $variable; sizes are pixels, fill_container or fit_content. text needs content, icon needs iconName, path needs geometry, ref needs ref.";

/** Validate one raw node (ids already assigned). Returns the parsed node and ignored props. */
export const parseNode = (raw: unknown, label: string): { node: PegoNode; ignored: string[] } => {
  const parsed = nodeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ToolError("invalid_node", `${label}: ${formatZodError(parsed.error)}`, NODE_HINT);
  }
  return { node: parsed.data, ignored: droppedProps(raw, parsed.data, label, []) };
};

/** Every ref inside `node` must target a reusable node that exists now or is created by `node`. */
const checkRefs = (doc: PegoDocument, node: PegoNode): void => {
  const reusable = new Set<string>();
  const refs: { id: string; target: string }[] = [];
  const walk = (n: PegoNode): void => {
    if (n.reusable) reusable.add(n.id);
    if (n.type === "ref") refs.push({ id: n.id, target: n.ref });
    if (isContainer(n)) n.children.forEach(walk);
  };
  walk(node);
  for (const { id, target } of refs) {
    if (reusable.has(target)) continue;
    const found = findLocation(doc, target)?.node;
    if (found?.reusable) continue;
    throw new ToolError(
      "ref_target_invalid",
      `ref node "${id}" points at "${target}", which is not a reusable node`,
      found
        ? `Node "${target}" exists but is not a component. Set reusable: true on it with update_node first.`
        : "Create the component first (a frame with reusable: true), then reference its id.",
    );
  }
};

// --- committing ops ------------------------------------------------------------

const describeOp = (op: Op): string => {
  switch (op.op) {
    case "insert":
      return `insert into ${op.parentId ?? "root"}`;
    case "update":
    case "replace":
    case "move":
    case "delete":
      return `${op.op} ${op.id}`;
    case "setVariables":
      return "setVariables";
  }
};

/** Ids the agent touched that still exist after the ops (deleted nodes focus their parent). */
const focusAfter = (before: PegoDocument, after: PegoDocument, ops: Op[]): string[] => {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op === "insert" || op.op === "replace") ids.add(op.node.id);
    else if (op.op === "update" || op.op === "move") ids.add(op.id);
    else if (op.op === "delete") {
      const parentId = findLocation(before, op.id)?.parentId;
      if (parentId) ids.add(parentId);
    }
  }
  // Pages have no box on the canvas to highlight.
  return [...ids].filter((id) => {
    const node = findLocation(after, id)?.node;
    return node !== undefined && node.type !== "page";
  });
};

/**
 * Dry-run the ops against the current document to report which op failed and why, then hand the
 * whole batch to the host in one call (all or nothing) and focus the touched nodes.
 */
export const commitOps = (host: ToolHost, requested: Op[]): void => {
  const before = host.getDoc();
  const pageId = activePageId(host);
  let current = before;
  const ops: Op[] = [];
  requested.forEach((raw, index) => {
    const op = onActivePage(current, raw, pageId);
    ops.push(op);
    try {
      if (op.op === "insert" || op.op === "replace") checkRefs(current, op.node);
      current = applyOp(current, op);
    } catch (error) {
      const prefix = ops.length > 1 ? `op ${index} (${describeOp(op)}): ` : "";
      if (error instanceof OpError) throw new OpError(error.code, prefix + error.message);
      if (error instanceof ToolError)
        throw new ToolError(error.code, prefix + error.message, error.hint);
      throw error;
    }
  });
  host.applyOps(ops);
  host.setFocus(focusAfter(before, host.getDoc(), ops));
};

/** The page tools treat as "the document root" for content: the user's page, else the first. */
export const activePageId = (host: ToolHost): string =>
  pageOrFirst(host.getDoc(), host.getActivePageId?.()).id;

/** See placeOnPage: tools treat a null parent as the top level of the active page. */
export const onActivePage = placeOnPage;

export type CreatedNode = { id: string; type: string; name?: string; children?: CreatedNode[] };

/** The created id tree returned to the model (name to id, nested like the input). */
export const idTree = (node: PegoNode): CreatedNode => ({
  id: node.id,
  type: node.type,
  ...(node.name ? { name: node.name } : {}),
  ...(isContainer(node) && node.children.length > 0 ? { children: node.children.map(idTree) } : {}),
});
