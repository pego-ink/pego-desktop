import { createId, isContainer, type InsertOp, type PegoDocument, type PegoNode } from "@pego/doc";

/** A reusable node (component) of the document. */
export type ComponentEntry = { id: string; name: string };

/** Every component of the document, in tree order (nested ones too). */
export const listComponents = (doc: PegoDocument): ComponentEntry[] => {
  const found: ComponentEntry[] = [];
  const walk = (nodes: readonly PegoNode[]) => {
    for (const node of nodes) {
      if (node.reusable === true) found.push({ id: node.id, name: node.name ?? node.type });
      if (isContainer(node)) walk(node.children);
    }
  };
  walk(doc.children);
  return found;
};

/** Insert an instance (ref) of `component`, named after it, at the top level, at (x, y). */
export const instanceOp = (
  component: Pick<ComponentEntry, "id" | "name">,
  at: { x: number; y: number },
): InsertOp => ({
  op: "insert",
  parentId: null,
  node: {
    type: "ref",
    id: createId(),
    name: component.name,
    ref: component.id,
    x: Math.round(at.x),
    y: Math.round(at.y),
  },
});
