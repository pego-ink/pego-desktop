import { createId, isContainer, type InsertOp, type PegoDocument, type PegoNode } from "@pego/doc";

/** A reusable node (component) of the document and the page it lives on. */
export type ComponentEntry = { id: string; name: string; pageId: string; pageName: string };

/** Every component of the document, page by page, in tree order. */
export const listComponents = (doc: PegoDocument): ComponentEntry[] => {
  const found: ComponentEntry[] = [];
  const walk = (nodes: readonly PegoNode[], pageId: string, pageName: string) => {
    for (const node of nodes) {
      if (node.reusable === true) {
        found.push({ id: node.id, name: node.name ?? node.type, pageId, pageName });
      }
      if (isContainer(node)) walk(node.children, pageId, pageName);
    }
  };
  for (const page of doc.children) walk(page.children, page.id, page.name);
  return found;
};

/** Insert an instance (ref) of `component`, named after it, at the top level of `pageId`, at (x, y). */
export const instanceOp = (
  component: Pick<ComponentEntry, "id" | "name">,
  pageId: string,
  at: { x: number; y: number },
): InsertOp => ({
  op: "insert",
  parentId: pageId,
  node: {
    type: "ref",
    id: createId(),
    name: component.name,
    ref: component.id,
    x: Math.round(at.x),
    y: Math.round(at.y),
  },
});
