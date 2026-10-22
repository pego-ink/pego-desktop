import {
  collectIds,
  findLocation,
  findNode,
  isContainer,
  nodeSchema,
  type PegoDocument,
  type PegoNode,
  type RefNode,
} from "@pego/doc";
import { ToolError } from "../tool-kit";

export type Overrides = Record<string, Record<string, unknown>>;

/** Keys that cannot be overridden on a descendant (mirrors resolveInstance). */
const PROTECTED_KEYS = new Set(["id", "type", "children"]);

/** Keys that belong to the ref itself and never come from instance props. */
const REF_OWN_KEYS = new Set(["id", "type", "ref", "descendants", "children", "reusable"]);

export const NOT_FOUND_HINT =
  "Call get_document to see the current ids. Ids inside a component instance (like a/b) cannot be edited directly: use set_instance_overrides on the ref node, or detach_instance first.";

/** Node that exists as a real (non-expanded) node of the document. */
export const requireNode = (doc: PegoDocument, id: string): PegoNode => {
  const node = findNode(doc, id);
  if (node) return node;
  throw new ToolError(
    "node_not_found",
    id.includes("/")
      ? `node "${id}" is inside a component instance and cannot be edited directly`
      : `node "${id}" not found`,
    NOT_FOUND_HINT,
  );
};

/** A reusable node (component) that exists in the document. */
export const requireComponent = (doc: PegoDocument, id: string): PegoNode => {
  const node = findNode(doc, id);
  if (!node) {
    throw new ToolError(
      "component_not_found",
      `component "${id}" not found`,
      "Pass the id of a node with reusable: true. Use create_component to turn a frame into one, or read get_document, which lists the reusable components.",
    );
  }
  if (!node.reusable) {
    throw new ToolError(
      "not_a_component",
      `node "${id}" is not reusable`,
      "Call create_component with this node id first (or set reusable: true on it).",
    );
  }
  return node;
};

export const requireInstance = (doc: PegoDocument, id: string): RefNode => {
  const node = requireNode(doc, id);
  if (node.type === "ref") return node;
  throw new ToolError(
    "not_an_instance",
    `node "${id}" is a ${node.type}, not a component instance (ref)`,
    "Pass the id of a ref node, as returned by create_instance or shown as `ref#...` in get_document.",
  );
};

/** Descendants of a component keyed by id (the root itself is edited with the instance props). */
const componentDescendants = (component: PegoNode): Map<string, PegoNode> => {
  const found = new Map<string, PegoNode>();
  const walk = (node: PegoNode): void => {
    if (!isContainer(node)) return;
    for (const child of node.children) {
      found.set(child.id, child);
      walk(child);
    }
  };
  walk(component);
  return found;
};

/**
 * Check overrides against a component: every key is a descendant id and the overridden props
 * still make a valid node of that type. Returns nothing, throws ToolError with a hint.
 */
export const validateOverrides = (
  doc: PegoDocument,
  componentId: string,
  overrides: Overrides,
): void => {
  const component = requireComponent(doc, componentId);
  const descendants = componentDescendants(component);
  for (const [descendantId, props] of Object.entries(overrides)) {
    const target = descendants.get(descendantId);
    if (!target) {
      const valid =
        [...descendants.keys()].slice(0, 12).join(", ") || "(the component has no children)";
      throw new ToolError(
        "invalid_override_target",
        `"${descendantId}" is not a descendant of component "${componentId}"`,
        `Override keys are ids of nodes inside the component. Valid ids: ${valid}.`,
      );
    }
    const forbidden = Object.keys(props).filter((key) => PROTECTED_KEYS.has(key));
    if (forbidden.length > 0) {
      throw new ToolError(
        "invalid_override",
        `override for "${descendantId}" sets ${forbidden.join(", ")}, which cannot be overridden`,
        "Override visual props only (content, fill, width, ...). id, type and children are fixed by the component.",
      );
    }
    const merged = { ...target, ...props, ...(isContainer(target) ? { children: [] } : {}) };
    const parsed = nodeSchema.safeParse(merged);
    if (!parsed.success) {
      throw new ToolError(
        "invalid_override",
        `override for "${descendantId}" is invalid: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
        `Check prop names and value types for a ${target.type} node.`,
      );
    }
  }
};

/** Props accepted on the instance root (x, y, width, height, name, opacity, ...). */
export const instanceRootProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const forbidden = Object.keys(props).filter((key) => REF_OWN_KEYS.has(key));
  if (forbidden.length > 0) {
    throw new ToolError(
      "invalid_props",
      `instance props cannot set ${forbidden.join(", ")}`,
      "Use `overrides` for descendants of the component; ref, id and type are set by the tool.",
    );
  }
  return props;
};

/** Component ids (reusable ancestors included) whose subtree is, or transitively instantiates, `target`. */
const usesComponent = (
  doc: PegoDocument,
  component: PegoNode,
  target: string,
  seen = new Set<string>(),
): boolean => {
  if (component.id === target) return true;
  if (seen.has(component.id)) return false;
  seen.add(component.id);
  const walk = (node: PegoNode): boolean => {
    if (node.type === "ref") {
      const source = findNode(doc, node.ref);
      if (source && usesComponent(doc, source, target, seen)) return true;
    }
    return isContainer(node) && node.children.some(walk);
  };
  return walk(component);
};

/** True when placing an instance of `componentId` under `parentId` would make a component contain itself. */
export const wouldCycle = (
  doc: PegoDocument,
  componentId: string,
  parentId: string | null,
): boolean => {
  if (parentId === null) return false;
  const component = findNode(doc, componentId);
  if (!component) return false;
  let cursor: string | null = parentId;
  while (cursor !== null) {
    const loc = findLocation(doc, cursor);
    if (!loc) return false;
    if (loc.node.reusable && usesComponent(doc, component, loc.node.id)) return true;
    cursor = loc.parentId;
  }
  return collectIds(component).has(parentId);
};

export const assertNoCycle = (
  doc: PegoDocument,
  componentId: string,
  parentId: string | null,
): void => {
  if (!wouldCycle(doc, componentId, parentId)) return;
  throw new ToolError(
    "instance_cycle",
    `an instance of "${componentId}" inside "${parentId}" would make the component contain itself`,
    "Insert the instance outside the component, or instantiate a different component.",
  );
};

/** Every ref inside `node` must target a reusable node that exists now or is created by `node`. */
export const checkRefs = (doc: PegoDocument, node: PegoNode): void => {
  const reusable = new Set<string>();
  const refs: { id: string; target: string }[] = [];
  const walk = (n: PegoNode): void => {
    if (n.reusable) reusable.add(n.id);
    if (n.type === "ref") refs.push({ id: n.id, target: n.ref });
    if (isContainer(n)) n.children.forEach(walk);
  };
  walk(node);
  for (const { id, target } of refs) {
    if (reusable.has(target) || findNode(doc, target)?.reusable) continue;
    throw new ToolError(
      "ref_target_invalid",
      `ref node "${id}" points at "${target}", which is not a reusable node`,
      "Create the component first (create_component or reusable: true), then reference its id.",
    );
  }
};
