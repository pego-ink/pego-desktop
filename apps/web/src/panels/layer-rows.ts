import { findNode, isContainer, pageOrFirst, type PegoDocument, type PegoNode } from "@pego/doc";

export type LayerRowData = {
  node: PegoNode;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
};

/** Visible rows in document order. Containers are expanded unless their id is in `collapsed`. */
export const flattenLayers = (
  doc: PegoDocument,
  collapsed: ReadonlySet<string>,
  /** Page whose layers are listed (null = the first). */
  pageId: string | null = null,
): LayerRowData[] => {
  const rows: LayerRowData[] = [];
  const walk = (nodes: PegoNode[], depth: number, parentId: string | null) => {
    for (const node of nodes) {
      const hasChildren = isContainer(node) && node.children.length > 0;
      const expanded = hasChildren && !collapsed.has(node.id);
      rows.push({ node, depth, parentId, hasChildren, expanded });
      if (isContainer(node) && expanded) walk(node.children, depth + 1, node.id);
    }
  };
  walk(pageOrFirst(doc, pageId).children, 0, null);
  return rows;
};

/** Ids of every ancestor container of `id` (nearest first), pages excluded. */
export const ancestorIds = (doc: PegoDocument, id: string): string[] => {
  const walk = (nodes: PegoNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      if (node.id === id) return trail;
      if (!isContainer(node)) continue;
      const found = walk(node.children, [node.id, ...trail]);
      if (found) return found;
    }
    return null;
  };
  for (const page of doc.children) {
    const found = walk(page.children, []);
    if (found) return found;
  }
  return [];
};

/** Row label: own name, else the referenced component's name for refs ("Instance" if missing), else the type. */
export const layerLabel = (doc: PegoDocument, node: PegoNode): string => {
  if (node.name) return node.name;
  if (node.type !== "ref") return node.type;
  return findNode(doc, node.ref)?.name || "Instance";
};
