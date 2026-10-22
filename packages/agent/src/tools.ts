import { z } from "zod";
import {
  collectDocIds,
  findLocation,
  isContainer,
  opSchema,
  variableSchema,
  type Op,
} from "@pego/doc";
import {
  NODE_FORMAT_DESCRIPTION,
  idJsonSchema,
  indexJsonSchema,
  nodeJsonSchema,
  parentIdJsonSchema,
  propsJsonSchema,
  variableJsonSchema,
} from "./json-schemas";
import { serializeDocument } from "./serialize";
import {
  assignIds,
  commitOps,
  defineTool,
  formatZodError,
  idTree,
  NODE_HINT,
  ok,
  parseNode,
  ToolError,
} from "./tool-kit";
import type { ToolSpec } from "./types";

const id = z.string().min(1);
const parentId = id.nullable();
const index = z.number().int().nonnegative();

const withWarnings = (data: Record<string, unknown>, ignored: string[]) =>
  ok(
    ignored.length > 0
      ? {
          ...data,
          warnings: [
            `Ignored props that do not exist on that node type: ${ignored.join(", ")}. Use get_node to check what was stored.`,
          ],
        }
      : data,
  );

// --- reading -----------------------------------------------------------------

const getDocument = defineTool({
  name: "get_document",
  description:
    'Read the document as compact text: one line per node (`type#id "name" [component] prop=value ...`) with children indented, plus the variables and the list of reusable components. ' +
    "Defaults are omitted: x/y = 0, layout none. x/y are shown only for children of non-flex parents. " +
    "Call this before editing and again after a batch of edits to verify the result. " +
    "On a large document pass rootId to read one subtree and maxDepth to limit the levels shown (deeper containers show a child count).",
  inputSchema: {
    type: "object",
    properties: {
      rootId: idJsonSchema("Read only this node and its subtree. Omit for the whole document."),
      maxDepth: {
        type: "integer",
        minimum: 0,
        description: "Levels shown below the starting level. Omit for all levels.",
      },
    },
    additionalProperties: false,
  },
  schema: z.strictObject({ rootId: id.optional(), maxDepth: index.optional() }),
  inputHint: "Both fields are optional: {rootId?: string, maxDepth?: integer >= 0}.",
  run: (input, host) => ok({ document: serializeDocument(host.getDoc(), input) }),
});

const getNode = defineTool({
  name: "get_node",
  description:
    "Read every prop of one node (including defaults such as x and y), its parent id and its index among the parent's children, and the id, type and name of its direct children. " +
    "Use it when get_document does not show enough, for example the full geometry of a path.",
  inputSchema: {
    type: "object",
    properties: { id: idJsonSchema("Id of the node to read.") },
    required: ["id"],
    additionalProperties: false,
  },
  schema: z.strictObject({ id }),
  inputHint: "Pass {id: string}.",
  run: ({ id: nodeId }, host) => {
    const loc = findLocation(host.getDoc(), nodeId);
    if (!loc) {
      throw new ToolError(
        "node_not_found",
        `node "${nodeId}" not found`,
        "Call get_document to see the current ids. Ids inside a component instance (like a/b) cannot be read directly.",
      );
    }
    const { node } = loc;
    const props: Record<string, unknown> = { ...node };
    delete props.children;
    return ok({
      id: node.id,
      type: node.type,
      parentId: loc.parentId,
      index: loc.index,
      props,
      ...(isContainer(node)
        ? { children: node.children.map((c) => ({ id: c.id, type: c.type, name: c.name })) }
        : {}),
    });
  },
});

// --- writing -----------------------------------------------------------------

const insertNodes = defineTool({
  name: "insert_nodes",
  description:
    "Create nodes (with their whole subtrees) inside a frame or group, or at the document root with parentId null. " +
    "Omit `id` on any node, at any depth, and one is generated. The result lists the created ids as a tree (name to id), so you can reference them in later calls without reading the document again. " +
    "Build a whole section in one call by nesting children. Prefer a frame with layout horizontal or vertical over x/y positions.",
  inputSchema: {
    type: "object",
    properties: {
      parentId: parentIdJsonSchema,
      index: indexJsonSchema,
      nodes: {
        type: "array",
        minItems: 1,
        description: "Nodes to insert, in order.",
        items: nodeJsonSchema,
      },
    },
    required: ["parentId", "nodes"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    parentId,
    index: index.optional(),
    nodes: z.array(z.unknown()).min(1),
  }),
  inputHint: `Pass {parentId: string | null, index?: integer, nodes: node[]}. ${NODE_HINT}`,
  run: (input, host) => {
    const taken = collectDocIds(host.getDoc());
    const parsed = input.nodes.map((raw, i) => parseNode(assignIds(raw, taken), `nodes[${i}]`));
    const ops: Op[] = parsed.map(({ node }, i) => ({
      op: "insert",
      parentId: input.parentId,
      ...(input.index === undefined ? {} : { index: input.index + i }),
      node,
    }));
    commitOps(host, ops);
    return withWarnings(
      { ok: true, created: parsed.map(({ node }) => idTree(node)) },
      parsed.flatMap(({ ignored }) => ignored),
    );
  },
});

const updateNode = defineTool({
  name: "update_node",
  description:
    "Change props of one existing node. Only the props you pass change; null removes a prop (back to its default). " +
    "Cannot change id, type or children (use move_node, insert_nodes, delete_nodes or replace_node for those). " +
    "For an instance (ref node), change instance-level props directly and use `descendants` to override props of nodes inside the component.",
  inputSchema: {
    type: "object",
    properties: { id: idJsonSchema("Id of the node to change."), props: propsJsonSchema },
    required: ["id", "props"],
    additionalProperties: false,
  },
  schema: z.strictObject({ id, props: z.record(z.string(), z.unknown()) }),
  inputHint: "Pass {id: string, props: {propName: value | null}}.",
  run: (input, host) => {
    commitOps(host, [{ op: "update", id: input.id, props: input.props }]);
    return ok({ ok: true, id: input.id, updated: Object.keys(input.props) });
  },
});

const replaceNode = defineTool({
  name: "replace_node",
  description:
    "Replace a node and its whole subtree with a new node in the same place. The new root keeps the old id unless you give it another one; nodes inside get generated ids unless you provide them. " +
    "Use it to restructure a section. For small changes use update_node.",
  inputSchema: {
    type: "object",
    properties: { id: idJsonSchema("Id of the node to replace."), node: nodeJsonSchema },
    required: ["id", "node"],
    additionalProperties: false,
  },
  schema: z.strictObject({ id, node: z.unknown() }),
  inputHint: `Pass {id: string, node: node}. ${NODE_HINT}`,
  run: (input, host) => {
    const taken = collectDocIds(host.getDoc());
    const { node, ignored } = parseNode(assignIds(input.node, taken, input.id), "node");
    commitOps(host, [{ op: "replace", id: input.id, node }]);
    return withWarnings({ ok: true, created: idTree(node) }, ignored);
  },
});

const moveNode = defineTool({
  name: "move_node",
  description:
    "Move a node (with its subtree) to another parent or to another position among its siblings. parentId null moves it to the document root. " +
    "To reorder inside the same parent pass the same parentId and the new index.",
  inputSchema: {
    type: "object",
    properties: {
      id: idJsonSchema("Id of the node to move."),
      parentId: parentIdJsonSchema,
      index: indexJsonSchema,
    },
    required: ["id", "parentId"],
    additionalProperties: false,
  },
  schema: z.strictObject({ id, parentId, index: index.optional() }),
  inputHint: "Pass {id: string, parentId: string | null, index?: integer}.",
  run: (input, host) => {
    commitOps(host, [
      {
        op: "move",
        id: input.id,
        parentId: input.parentId,
        ...(input.index === undefined ? {} : { index: input.index }),
      },
    ]);
    return ok({ ok: true, id: input.id, parentId: input.parentId });
  },
});

/** Drop ids whose ancestor is also in the list: deleting the ancestor already removes them. */
const withoutNestedIds = (
  ids: string[],
  parentOf: (nodeId: string) => string | null | undefined,
): string[] => {
  const wanted = new Set(ids);
  const hasWantedAncestor = (nodeId: string): boolean => {
    for (let p = parentOf(nodeId); p; p = parentOf(p)) if (wanted.has(p)) return true;
    return false;
  };
  return [...wanted].filter((nodeId) => !hasWantedAncestor(nodeId));
};

const deleteNodes = defineTool({
  name: "delete_nodes",
  description:
    "Delete nodes and their subtrees. All ids are removed in one step or none are. " +
    "Instances (ref nodes) that point at a deleted component stop rendering, so delete or update them as well.",
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
        description: "Ids of the nodes to delete.",
      },
    },
    required: ["ids"],
    additionalProperties: false,
  },
  schema: z.strictObject({ ids: z.array(id).min(1) }),
  inputHint: "Pass {ids: string[]} with at least one id.",
  run: ({ ids }, host) => {
    const doc = host.getDoc();
    const targets = withoutNestedIds(ids, (nodeId) => findLocation(doc, nodeId)?.parentId);
    commitOps(
      host,
      targets.map((nodeId): Op => ({ op: "delete", id: nodeId })),
    );
    return ok({ ok: true, deleted: targets });
  },
});

const setVariables = defineTool({
  name: "set_variables",
  description:
    "Create, change or remove document variables. Reference a variable as `$name` in colors, numbers and text content, so a change here updates every use. " +
    "Keys are names without the leading $. A value is {type: color | number | string, value}; null removes the variable. " +
    "Create variables for colors and spacing that repeat (brand colors, text colors, gaps, radii).",
  inputSchema: {
    type: "object",
    properties: {
      variables: {
        type: "object",
        description: "Variables to set, keyed by name without $. null removes one.",
        additionalProperties: { anyOf: [variableJsonSchema, { type: "null" }] },
      },
    },
    required: ["variables"],
    additionalProperties: false,
  },
  schema: z.strictObject({ variables: z.record(z.string().min(1), variableSchema.nullable()) }),
  inputHint:
    'Pass {variables: {"accent": {"type": "color", "value": "#0E7C5A"}, "old": null}}. Color values are hex.',
  run: (input, host) => {
    const variables = Object.fromEntries(
      Object.entries(input.variables).map(([name, value]) => [name.replace(/^\$/, ""), value]),
    );
    commitOps(host, [{ op: "setVariables", variables }]);
    return ok({ ok: true, variables: Object.keys(variables) });
  },
});

const applyOpsTool = defineTool({
  name: "apply_ops",
  description:
    "Apply several edits as one atomic batch: if any op fails nothing changes and the error names the failing op by index. Ops run in order, so later ops can use ids created by earlier ones. " +
    "Use it for multi-step edits such as inserting a component and then instances of it, or restyling many nodes. " +
    "Ops: {op: insert, parentId, index?, node} | {op: update, id, props} | {op: replace, id, node} | {op: move, id, parentId, index?} | {op: delete, id} | {op: setVariables, variables}. " +
    "Nodes in insert and replace may omit ids (generated; the result lists them).",
  inputSchema: {
    type: "object",
    properties: {
      ops: {
        type: "array",
        minItems: 1,
        description: "Operations to apply in order.",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: ["insert", "update", "replace", "move", "delete", "setVariables"],
            },
            id: { type: "string", description: "Target node id (update, replace, move, delete)." },
            parentId: parentIdJsonSchema,
            index: indexJsonSchema,
            node: { type: "object", description: NODE_FORMAT_DESCRIPTION },
            props: {
              type: "object",
              description:
                "update: props to change (same props as update_node); null removes a prop.",
            },
            variables: {
              type: "object",
              description: "setVariables: name (without $) to variable, or null to remove.",
              additionalProperties: { anyOf: [variableJsonSchema, { type: "null" }] },
            },
          },
          required: ["op"],
          additionalProperties: false,
        },
      },
    },
    required: ["ops"],
    additionalProperties: false,
  },
  schema: z.strictObject({ ops: z.array(z.unknown()).min(1) }),
  inputHint:
    "Pass {ops: op[]}; every op has `op` plus the fields for that kind (insert: parentId, node; update: id, props; replace: id, node; move: id, parentId; delete: id; setVariables: variables).",
  run: (input, host) => {
    const taken = collectDocIds(host.getDoc());
    const ops: Op[] = [];
    const created: { op: number; nodes: ReturnType<typeof idTree>[] }[] = [];
    const ignored: string[] = [];

    input.ops.forEach((raw, i) => {
      const prepared = prepareOp(raw, taken);
      const parsed = opSchema.safeParse(prepared);
      if (!parsed.success) {
        throw new ToolError(
          "invalid_op",
          `ops[${i}]: ${formatZodError(parsed.error)}`,
          "Each op needs `op` plus its fields: insert {parentId, node}, update {id, props}, replace {id, node}, move {id, parentId}, delete {id}, setVariables {variables}.",
        );
      }
      const op = parsed.data;
      if (op.op === "insert" || op.op === "replace") {
        const rawNode = (prepared as { node?: unknown }).node;
        const { ignored: dropped } = parseNode(rawNode, `ops[${i}].node`);
        ignored.push(...dropped);
        if (op.op === "insert") created.push({ op: i, nodes: [idTree(op.node)] });
      }
      ops.push(op);
    });

    commitOps(host, ops);
    return withWarnings({ ok: true, applied: ops.length, created }, ignored);
  },
});

/** Fill ids on the node of an insert/replace op before schema validation. */
const prepareOp = (raw: unknown, taken: Set<string>): unknown => {
  if (typeof raw !== "object" || raw === null) return raw;
  const op = raw as { op?: unknown; id?: unknown; node?: unknown };
  if (op.op === "insert") return { ...op, node: assignIds(op.node, taken) };
  if (op.op === "replace") {
    const rootId = typeof op.id === "string" ? op.id : undefined;
    return { ...op, node: assignIds(op.node, taken, rootId) };
  }
  return raw;
};

// --- reporting & asking --------------------------------------------------------

const stepStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);

const reportPlan = defineTool({
  name: "report_plan",
  description:
    "Show the plan to the user as a checklist before you start editing. 2 to 8 concrete steps, each with a short title and an optional detail line. " +
    "Calling it again replaces the plan. Then report each step with report_step as you work.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1, description: "Short unique id, e.g. s1." },
            title: {
              type: "string",
              minLength: 1,
              description: "What this step does, a few words.",
            },
            detail: {
              type: "string",
              description: "Optional: how, or what the result looks like.",
            },
          },
          required: ["id", "title"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    steps: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          title: z.string().min(1),
          detail: z.string().optional(),
        }),
      )
      .min(1)
      .max(12),
  }),
  inputHint: "Pass {steps: [{id, title, detail?}]} with 1 to 12 steps.",
  run: ({ steps }, host) => {
    const ids = new Set(steps.map((s) => s.id));
    if (ids.size !== steps.length) {
      throw new ToolError(
        "duplicate_step_id",
        "step ids must be unique",
        "Give each step its own id, e.g. s1, s2, s3.",
      );
    }
    host.reportPlan(steps);
    return ok({ ok: true, steps: steps.length });
  },
});

const reportStep = defineTool({
  name: "report_step",
  description:
    "Update the status of a plan step: running when you start it, done when it is finished and verified, failed if it could not be completed, skipped if it is no longer needed. " +
    "Add a one-line summary of the outcome when you finish a step.",
  inputSchema: {
    type: "object",
    properties: {
      stepId: { type: "string", minLength: 1, description: "Id of the step from report_plan." },
      status: { type: "string", enum: ["pending", "running", "done", "failed", "skipped"] },
      summary: { type: "string", description: "One line on what was done or why it failed." },
    },
    required: ["stepId", "status"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    stepId: z.string().min(1),
    status: stepStatus,
    summary: z.string().optional(),
  }),
  inputHint:
    "Pass {stepId: string, status: pending | running | done | failed | skipped, summary?: string}.",
  run: (input, host) => {
    host.reportStep(input.stepId, input.status, input.summary);
    return ok({ ok: true });
  },
});

const askUser = defineTool({
  name: "ask_user",
  description:
    "Ask the user to choose between 2 to 4 options and wait for the answer. Use it only for a real fork where the choice changes the design and you cannot reasonably decide yourself " +
    "(for example two different directions for a hero section). Do not use it for details you can pick sensibly. Make each option a short, self-explanatory label.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", minLength: 1, description: "One clear question." },
      options: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: { type: "string", minLength: 1 },
        description: "The choices, as short labels.",
      },
      stepId: { type: "string", description: "Optional: the plan step this question belongs to." },
    },
    required: ["question", "options"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(4),
    stepId: z.string().min(1).optional(),
  }),
  inputHint: "Pass {question: string, options: string[] with 2 to 4 items}.",
  run: async (input, host) => {
    const choice = await host.askUser({
      question: input.question,
      options: input.options,
      ...(input.stepId ? { stepId: input.stepId } : {}),
    });
    return ok({ choice });
  },
});

/** Every tool the agent can use, shared by the in-browser loop, MCP and the Agent SDK. */
export const agentTools: ToolSpec[] = [
  getDocument,
  getNode,
  insertNodes,
  updateNode,
  replaceNode,
  moveNode,
  deleteNodes,
  setVariables,
  applyOpsTool,
  reportPlan,
  reportStep,
  askUser,
];

export const toolByName = (name: string): ToolSpec | undefined =>
  agentTools.find((tool) => tool.name === name);
