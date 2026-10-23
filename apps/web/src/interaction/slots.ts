import {
  createId,
  findLocation,
  findNode,
  isContainer,
  type FrameNode,
  type Op,
  type PegoDocument,
  type PegoNode,
  type RefNode,
} from "@pego/doc";

/**
 * Slots: a frame inside a component that each instance can fill with its own content, plus the
 * components recommended for it. The component side marks frames as slots and edits the list;
 * the instance side fills a slot with an instance of a recommended component (stored as the
 * slot's `children` override, see resolveInstance) or resets it to the component's content.
 */

/** The component `id` belongs to (itself or its nearest reusable ancestor), or null. */
export const componentAround = (doc: PegoDocument, id: string): PegoNode | null => {
  let current: string | null = id;
  while (current) {
    const loc = findLocation(doc, current);
    if (!loc) return null;
    if (loc.node.reusable === true) return loc.node;
    current = loc.parentId;
  }
  return null;
};

/** The slot frames of a component, in tree order. */
export const slotsOf = (component: PegoNode): FrameNode[] => {
  const found: FrameNode[] = [];
  const walk = (node: PegoNode) => {
    if (node.type === "frame" && node.slot) found.push(node);
    if (isContainer(node)) node.children.forEach(walk);
  };
  if (isContainer(component)) component.children.forEach(walk);
  return found;
};

/** Every component of the document except `exclude` (a slot of a component cannot hold itself). */
export const componentChoices = (doc: PegoDocument, exclude: string | null): PegoNode[] => {
  const found: PegoNode[] = [];
  const walk = (nodes: readonly PegoNode[]) => {
    for (const node of nodes) {
      if (node.reusable === true && node.id !== exclude) found.push(node);
      if (isContainer(node)) walk(node.children);
    }
  };
  walk(doc.children);
  return found;
};

/** Make slot / Remove slot on a frame. */
export const toggleSlotOp = (frame: FrameNode): Op => ({
  op: "update",
  id: frame.id,
  props: { slot: frame.slot ? null : [] },
});

/** Add or remove a recommended component of a slot. */
export const recommendOp = (frame: FrameNode, componentId: string, add: boolean): Op => {
  const current = frame.slot ?? [];
  const next = add
    ? [...current.filter((id) => id !== componentId), componentId]
    : current.filter((id) => id !== componentId);
  return { op: "update", id: frame.id, props: { slot: next } };
};

/** The instance's override of one slot (its own content), if any. */
export const slotFill = (instance: RefNode, slotId: string): PegoNode[] | null => {
  const children = instance.descendants?.[slotId]?.children;
  return Array.isArray(children) ? (children as PegoNode[]) : null;
};

/** Fill an instance's slot with a new instance of `componentId`. */
export const fillSlotOp = (instance: RefNode, slotId: string, componentId: string): Op => {
  const descendants = instance.descendants ?? {};
  const fill = { type: "ref", id: createId(), ref: componentId, x: 0, y: 0 };
  return {
    op: "update",
    id: instance.id,
    props: {
      descendants: { ...descendants, [slotId]: { ...descendants[slotId], children: [fill] } },
    },
  };
};

/** Reset an instance's slot to the component's own content. */
export const clearSlotOp = (instance: RefNode, slotId: string): Op => {
  const descendants = { ...(instance.descendants ?? {}) };
  const rest = { ...descendants[slotId] };
  delete rest.children;
  if (Object.keys(rest).length > 0) descendants[slotId] = rest;
  else delete descendants[slotId];
  return {
    op: "update",
    id: instance.id,
    props: { descendants: Object.keys(descendants).length > 0 ? descendants : null },
  };
};

/** Name of a node for slot rows and buttons. */
export const nodeLabel = (doc: PegoDocument, id: string): string => {
  const node = findNode(doc, id);
  return node ? (node.name ?? node.type) : "Missing component";
};
