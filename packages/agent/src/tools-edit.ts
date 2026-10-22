import { z } from "zod";
import {
  applyOp,
  cloneWithFreshIds,
  createId,
  collectDocIds,
  findLocation,
  OpError,
  resolveInstance,
  resolveNumber,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import {
  assertNoCycle,
  checkRefs,
  instanceRootProps,
  requireComponent,
  requireInstance,
  requireNode,
  validateOverrides,
  type Overrides,
} from "./edit/components";
import { batchSchema, buildBatch, MAX_BATCH_OPERATIONS } from "./edit/batch";
import { idJsonSchema, indexJsonSchema, nodeJsonSchema, parentIdJsonSchema } from "./json-schemas";
import {
  activePageId,
  assignIds,
  commitOps,
  defineTool,
  idTree,
  ok,
  parseNode,
  ToolError,
} from "./tool-kit";
import type { JsonSchema, ToolSpec } from "./types";

const id = z.string().min(1);
const parentId = id.nullable();
const index = z.number().int().nonnegative();
const variableRef = z.string().regex(/^\$[A-Za-z_][\w-]*$/);
const position = z.union([z.number(), variableRef]);
const sizing = z.union([z.number(), z.literal("fill_container"), z.literal("fit_content")]);
const overridesSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

const ALIAS_NOTE =
  'Any id field accepts "@alias", the name given with `as` on an earlier operation of the same call.';

const overridesJsonSchema: JsonSchema = {
  type: "object",
  description:
    'Overrides keyed by the id of a descendant inside the component, e.g. {"label": {"content": "Buy now"}, "icon": {"fill": "#fff"}}. id, type and children cannot be overridden.',
  additionalProperties: { type: "object" },
};

const aliasJsonSchema: JsonSchema = {
  type: "string",
  description:
    "Name this node so later operations of the same call can reference it as @name (for example parent: @card).",
};

const refJsonSchema = (description: string): JsonSchema => ({
  type: "string",
  minLength: 1,
  description: `${description} A node id, or @alias of a node created earlier in this call.`,
});

const operationJsonSchema = (
  op: string,
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema => ({
  type: "object",
  description,
  properties: { op: { type: "string", enum: [op] }, ...properties },
  required: ["op", ...required],
  additionalProperties: false,
});

const batchParent: JsonSchema = {
  anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
  description: "Id or @alias of the frame/group to put the node in, or null for the document root.",
};

const batchOperationsJsonSchema: JsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_BATCH_OPERATIONS,
  description:
    "Operations applied in order. Later operations can use @aliases defined by earlier ones.",
  items: {
    anyOf: [
      operationJsonSchema(
        "insert",
        "Create a node (with its subtree) inside a parent.",
        { parent: batchParent, index: indexJsonSchema, node: nodeJsonSchema, as: aliasJsonSchema },
        ["parent", "node"],
      ),
      operationJsonSchema(
        "update",
        "Change props of a node. null removes a prop.",
        {
          target: refJsonSchema("Node to change."),
          props: { type: "object", description: "Props to merge (same as update_node)." },
        },
        ["target", "props"],
      ),
      operationJsonSchema(
        "replace",
        "Replace a node and its subtree. The new root keeps the target id unless it has its own.",
        {
          target: refJsonSchema("Node to replace."),
          // Same format as insert's node; not repeated to keep the tool definition small.
          node: { type: "object", description: "Node in the same format as for insert." },
          as: aliasJsonSchema,
        },
        ["target", "node"],
      ),
      operationJsonSchema(
        "move",
        "Move a node to another parent or position.",
        { target: refJsonSchema("Node to move."), parent: batchParent, index: indexJsonSchema },
        ["target", "parent"],
      ),
      operationJsonSchema(
        "delete",
        "Delete a node and its subtree.",
        {
          target: refJsonSchema("Node to delete."),
        },
        ["target"],
      ),
      operationJsonSchema(
        "copy",
        "Deep copy of a node (fresh ids) into a parent.",
        {
          source: refJsonSchema("Node to copy."),
          parent: batchParent,
          index: indexJsonSchema,
          overrides: {
            type: "object",
            description: "Props to change on the copy's root, e.g. {x: 400, name: 'Card 2'}.",
          },
          as: aliasJsonSchema,
        },
        ["source", "parent"],
      ),
      operationJsonSchema(
        "instance",
        "Create an instance (ref) of a component inside a parent.",
        {
          component: refJsonSchema("Reusable node to instantiate."),
          parent: batchParent,
          index: indexJsonSchema,
          props: {
            type: "object",
            description: "Props of the instance root, e.g. {x, y, width, height, name}.",
          },
          overrides: overridesJsonSchema,
          as: aliasJsonSchema,
        },
        ["component", "parent"],
      ),
    ],
  },
};

const withWarnings = (data: Record<string, unknown>, warnings: string[]) =>
  ok(warnings.length > 0 ? { ...data, warnings } : data);

// --- batch_design ------------------------------------------------------------

const batchDesign = defineTool({
  name: "batch_design",
  description:
    "Apply many edit operations in ONE atomic call (one undo step): insert, update, replace, move, delete, copy, instance. " +
    "Prefer it whenever you build or restructure a whole section or screen: create the container with `as`, then insert children into it as @alias in the same call, with no extra round trips to learn ids. " +
    `${ALIAS_NOTE} Operations run in order against the evolving document, so a copy or update can target a node created a few operations earlier. ` +
    `If any operation fails, nothing is applied and the error names the operation index and alias. Limit ${MAX_BATCH_OPERATIONS} operations per call. ` +
    "The result has `aliases` (alias to id) and `created` (id tree of every created node). " +
    "For a single small change use insert_nodes or update_node instead.",
  inputSchema: {
    type: "object",
    properties: { operations: batchOperationsJsonSchema },
    required: ["operations"],
    additionalProperties: false,
  },
  schema: batchSchema,
  inputHint:
    'Pass {operations: [{op: "insert", parent: "@hero" | id | null, node: {...}, as?: "name"}, {op: "update", target, props}, {op: "replace", target, node}, {op: "move", target, parent, index?}, {op: "delete", target}, {op: "copy", source, parent, overrides?}, {op: "instance", component, parent, props?, overrides?}]}. Each operation needs its `op` field.',
  run: (input, host) => {
    const result = buildBatch(host.getDoc(), input.operations, activePageId(host));
    host.applyOps(result.ops);
    host.setFocus(result.focus);
    return withWarnings(
      { ok: true, aliases: result.aliases, created: result.created },
      result.warnings,
    );
  },
});

// --- components --------------------------------------------------------------

const createComponent = defineTool({
  name: "create_component",
  description:
    "Turn an existing frame or group into a reusable component (sets reusable: true). Instances are made with create_instance. " +
    "Build the component first (one frame with its children, using layout), then make it a component, then instantiate it for repeated elements such as buttons, cards or list rows. " +
    "Nodes inside an instance and nodes that are already components are rejected.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: idJsonSchema("Id of the frame or group to make a component."),
      name: { type: "string", description: "Optional new name, e.g. Button/Primary." },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  schema: z.strictObject({ nodeId: id, name: z.string().min(1).optional() }),
  inputHint: "Pass {nodeId: string, name?: string}.",
  run: (input, host) => {
    const node = requireNode(host.getDoc(), input.nodeId);
    if (node.type !== "frame" && node.type !== "group") {
      throw new ToolError(
        "invalid_component",
        `only frames and groups can be components, "${input.nodeId}" is a ${node.type}`,
        "Wrap the node in a frame first (insert a frame and move the node into it), then call create_component on the frame.",
      );
    }
    if (node.reusable) {
      throw new ToolError(
        "already_component",
        `"${input.nodeId}" is already a component`,
        "Use create_instance with componentId to place instances of it.",
      );
    }
    commitOps(host, [
      {
        op: "update",
        id: node.id,
        props: { reusable: true, ...(input.name ? { name: input.name } : {}) },
      },
    ]);
    return ok({ ok: true, id: node.id, name: input.name ?? node.name, reusable: true });
  },
});

const createInstance = defineTool({
  name: "create_instance",
  description:
    "Insert an instance (ref node) of a component into a frame or group. The instance copies the component and can override x/y/size and descendant props. " +
    "Use `overrides` keyed by descendant ids of the component (see get_document) to change text, colors and so on per instance. " +
    "To place many instances together with other nodes in one call, use batch_design with op instance.",
  inputSchema: {
    type: "object",
    properties: {
      componentId: idJsonSchema("Id of a reusable node."),
      parentId: parentIdJsonSchema,
      index: indexJsonSchema,
      x: { type: "number", description: "Instance x (ignored in flex parents)." },
      y: { type: "number", description: "Instance y (ignored in flex parents)." },
      width: {
        anyOf: [{ type: "number" }, { type: "string", enum: ["fill_container", "fit_content"] }],
      },
      height: {
        anyOf: [{ type: "number" }, { type: "string", enum: ["fill_container", "fit_content"] }],
      },
      overrides: overridesJsonSchema,
    },
    required: ["componentId", "parentId"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    componentId: id,
    parentId,
    index: index.optional(),
    x: position.optional(),
    y: position.optional(),
    width: sizing.optional(),
    height: sizing.optional(),
    overrides: overridesSchema.optional(),
  }),
  inputHint:
    "Pass {componentId: string, parentId: string | null, index?, x?, y?, width?, height?, overrides?: {descendantId: {prop: value}}}.",
  run: (input, host) => {
    const doc = host.getDoc();
    requireComponent(doc, input.componentId);
    assertNoCycle(doc, input.componentId, input.parentId);
    if (input.overrides) validateOverrides(doc, input.componentId, input.overrides);
    const rootProps = instanceRootProps({
      ...(input.x === undefined ? {} : { x: input.x }),
      ...(input.y === undefined ? {} : { y: input.y }),
      ...(input.width === undefined ? {} : { width: input.width }),
      ...(input.height === undefined ? {} : { height: input.height }),
    });
    const taken = collectDocIds(doc);
    const raw = assignIds(
      {
        ...rootProps,
        type: "ref",
        ref: input.componentId,
        ...(input.overrides && Object.keys(input.overrides).length > 0
          ? { descendants: input.overrides }
          : {}),
      },
      taken,
    );
    const { node } = parseNode(raw, "instance");
    commitOps(host, [
      {
        op: "insert",
        parentId: input.parentId,
        ...(input.index === undefined ? {} : { index: input.index }),
        node,
      },
    ]);
    return ok({ ok: true, id: node.id, component: input.componentId });
  },
});

const setInstanceOverrides = defineTool({
  name: "set_instance_overrides",
  description:
    "Change the per-instance overrides of a component instance (ref node). `overrides` is keyed by descendant id of the component: " +
    "an object of props is merged into that descendant's existing overrides (a null prop value removes that one override), " +
    "and null for the descendant clears all its overrides. Other descendants keep their overrides. " +
    "Use it to change text/colors of one instance; to change every instance, edit the component itself.",
  inputSchema: {
    type: "object",
    properties: {
      instanceId: idJsonSchema("Id of the ref node (instance)."),
      overrides: {
        type: "object",
        description:
          'Keyed by descendant id: {"label": {"content": "Pay"}, "badge": null}. null clears that descendant; a null prop removes one override.',
        additionalProperties: {
          anyOf: [{ type: "object" }, { type: "null" }],
        },
      },
    },
    required: ["instanceId", "overrides"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    instanceId: id,
    overrides: z.record(z.string(), z.record(z.string(), z.unknown()).nullable()),
  }),
  inputHint: "Pass {instanceId: string, overrides: {descendantId: {prop: value} | null}}.",
  run: (input, host) => {
    const doc = host.getDoc();
    const instance = requireInstance(doc, input.instanceId);
    const next: Overrides = { ...instance.descendants } as Overrides;
    for (const [descendantId, change] of Object.entries(input.overrides)) {
      if (change === null) {
        delete next[descendantId];
        continue;
      }
      const merged: Record<string, unknown> = { ...next[descendantId] };
      for (const [key, value] of Object.entries(change)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      if (Object.keys(merged).length === 0) delete next[descendantId];
      else next[descendantId] = merged;
    }
    // Only the entries that were just set need checking; cleared ones are always fine.
    const touched = Object.fromEntries(
      Object.keys(input.overrides)
        .filter((key) => next[key] !== undefined)
        .map((key) => [key, next[key] as Record<string, unknown>]),
    );
    validateOverrides(doc, instance.ref, touched);
    const descendants = Object.keys(next).length > 0 ? next : null;
    commitOps(host, [{ op: "update", id: instance.id, props: { descendants } }]);
    return ok({ ok: true, id: instance.id, overrides: next });
  },
});

const detachInstance = defineTool({
  name: "detach_instance",
  description:
    "Turn a component instance into plain, independent nodes: the ref is replaced by a concrete copy of what it shows (overrides applied), at the same place with the same name/x/y. " +
    "All nodes get new ids, returned in the result. Use it when one instance needs structural changes that overrides cannot express. Later edits to the component no longer affect it.",
  inputSchema: {
    type: "object",
    properties: { instanceId: idJsonSchema("Id of the ref node to detach.") },
    required: ["instanceId"],
    additionalProperties: false,
  },
  schema: z.strictObject({ instanceId: id }),
  inputHint: "Pass {instanceId: string}.",
  run: (input, host) => {
    const doc = host.getDoc();
    const instance = requireInstance(doc, input.instanceId);
    const expanded = resolveInstance(doc, instance);
    if (!expanded) {
      throw new ToolError(
        "component_not_found",
        `instance "${instance.id}" points at "${instance.ref}", which is not a reusable node`,
        "The component was deleted or is no longer reusable. Delete this instance or restore the component.",
      );
    }
    const node = cloneWithFreshIds(expanded);
    commitOps(host, [{ op: "replace", id: instance.id, node }]);
    return ok({ ok: true, replaced: instance.id, created: idTree(node) });
  },
});

// --- copy_nodes ----------------------------------------------------------------

const isFlexParent = (doc: PegoDocument, id: string | null): boolean => {
  if (id === null) return false;
  const node = findLocation(doc, id)?.node;
  return node?.type === "frame" && node.layout !== "none";
};

const shift = (node: PegoNode, dx: number, dy: number, doc: PegoDocument): PegoNode => ({
  ...node,
  x: resolveNumber(node.x, doc.variables, 0) + dx,
  y: resolveNumber(node.y, doc.variables, 0) + dy,
});

const copyNodes = defineTool({
  name: "copy_nodes",
  description:
    "Duplicate nodes with their whole subtrees (fresh ids). Each copy goes right after its original, or into parentId when given (copies are appended there, or placed from `index`). " +
    "Copies are shifted by offset (default +20/+20) so they do not sit exactly on top of the original; no shift by default inside flex (horizontal/vertical) frames, where layout positions them. " +
    "Returns a map original id to copy id. To copy and change props in one go (or several copies into new containers), use batch_design with op copy.",
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: { type: "string", minLength: 1 },
        description: "Ids of the nodes to copy.",
      },
      parentId: {
        anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
        description:
          "Frame/group to put the copies in (null = document root). Omit to place each copy next to its original.",
      },
      offset: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        additionalProperties: false,
        description:
          "Shift applied to each copy's x/y. Default {x: 20, y: 20} outside flex frames.",
      },
      index: {
        ...indexJsonSchema,
        description: "With parentId: position of the first copy among the parent's children.",
      },
    },
    required: ["ids"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    ids: z.array(id).min(1).max(100),
    parentId: parentId.optional(),
    offset: z.strictObject({ x: z.number().default(0), y: z.number().default(0) }).optional(),
    index: index.optional(),
  }),
  inputHint:
    "Pass {ids: string[], parentId?: string | null, offset?: {x, y}, index?: integer >= 0}.",
  run: (input, host) => {
    const before = host.getDoc();
    let current = before;
    const ops: Op[] = [];
    const copies: Record<string, string> = {};
    input.ids.forEach((originalId, i) => {
      const loc = findLocation(current, originalId);
      if (!loc) {
        const hint = originalId.includes("/")
          ? "Nodes inside a component instance cannot be copied: detach_instance first."
          : "Call get_document to see the current ids.";
        throw new ToolError("node_not_found", `node "${originalId}" not found`, hint);
      }
      const destination =
        input.parentId === undefined ? loc.parentId : (input.parentId ?? activePageId(host));
      const at =
        input.parentId === undefined
          ? loc.index + 1
          : input.index === undefined
            ? undefined
            : input.index + i;
      const flex = isFlexParent(current, destination);
      const offset = input.offset ?? (flex ? { x: 0, y: 0 } : { x: 20, y: 20 });
      const copy = cloneWithFreshIds(loc.node);
      const node =
        offset.x === 0 && offset.y === 0 ? copy : shift(copy, offset.x, offset.y, current);
      const op: Op = {
        op: "insert",
        parentId: destination,
        ...(at === undefined ? {} : { index: at }),
        node,
      };
      checkRefs(current, node);
      try {
        current = applyOp(current, op);
      } catch (error) {
        if (error instanceof OpError) {
          throw new OpError(error.code, `copy of "${originalId}": ${error.message}`);
        }
        throw error;
      }
      ops.push(op);
      copies[originalId] = node.id;
    });
    commitOps(host, ops);
    return ok({ ok: true, copies });
  },
});

/** Productivity tools: batch_design, components, copy_nodes. */
// --- pages -------------------------------------------------------------------------

const createPage = defineTool({
  name: "create_page",
  description:
    "Add a page to the document (pages hold separate canvases, e.g. one per flow plus a Components page). " +
    "By default the editor switches to it, so later edits with parentId null land on the new page. Rename a page with update_node and remove one with delete_nodes (a document keeps at least one page).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, description: "Page name shown in the pages list." },
      index: indexJsonSchema,
      activate: {
        type: "boolean",
        description: "Switch the editor to the new page (default true).",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    name: z.string().trim().min(1),
    index: z.number().int().nonnegative().optional(),
    activate: z.boolean().optional(),
  }),
  inputHint: "Pass {name: string, index?: integer, activate?: boolean}.",
  run: (input, host) => {
    const page = {
      type: "page" as const,
      id: createId(),
      name: input.name,
      x: 0,
      y: 0,
      children: [],
    };
    commitOps(host, [
      {
        op: "insert",
        parentId: null,
        ...(input.index === undefined ? {} : { index: input.index }),
        node: page,
      },
    ]);
    if (input.activate !== false) host.setActivePage?.(page.id);
    return ok({
      ok: true,
      id: page.id,
      active: input.activate !== false && Boolean(host.setActivePage),
    });
  },
});

const goToPage = defineTool({
  name: "go_to_page",
  description:
    "Show a page in the editor. Later edits with parentId null go to this page, and get_document shows its tree.",
  inputSchema: {
    type: "object",
    properties: { pageId: idJsonSchema("Id of the page to show (see pages: in get_document).") },
    required: ["pageId"],
    additionalProperties: false,
  },
  schema: z.strictObject({ pageId: id }),
  inputHint: "Pass {pageId: string}.",
  run: (input, host) => {
    const page = host.getDoc().children.find((candidate) => candidate.id === input.pageId);
    if (!page) {
      throw new ToolError(
        "page_not_found",
        `page "${input.pageId}" not found`,
        "Call get_document: the pages line lists every page id.",
      );
    }
    if (!host.setActivePage) {
      throw new ToolError("unsupported", "This editor connection cannot switch pages.");
    }
    host.setActivePage(page.id);
    return ok({ ok: true, page: page.id, name: page.name });
  },
});

export const editTools: ToolSpec[] = [
  batchDesign,
  createComponent,
  createInstance,
  setInstanceOverrides,
  detachInstance,
  copyNodes,
  createPage,
  goToPage,
];
