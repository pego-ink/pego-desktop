import type { FrameNode, GroupNode, PageNode, PegoDocument, PegoNode } from "./schema";

export type ContainerNode = FrameNode | GroupNode | PageNode;

/** Where a node sits: `path` is the index chain from `doc.children` down to the node. */
export type NodeLocation = {
  node: PegoNode;
  parentId: string | null;
  index: number;
  path: number[];
};

export const isContainer = (node: PegoNode): node is ContainerNode =>
  node.type === "frame" || node.type === "group" || node.type === "page";

/** The node's mirror flags (pages never flip). */
export const flipOf = (node: PegoNode): { x: boolean; y: boolean } =>
  node.type === "page"
    ? { x: false, y: false }
    : { x: node.flipX === true, y: node.flipY === true };

export const findLocation = (doc: PegoDocument, id: string): NodeLocation | null => {
  const walk = (
    nodes: PegoNode[],
    parentId: string | null,
    prefix: number[],
  ): NodeLocation | null => {
    for (const [index, node] of nodes.entries()) {
      const path = [...prefix, index];
      if (node.id === id) return { node, parentId, index, path };
      if (!isContainer(node)) continue;
      const found = walk(node.children, node.id, path);
      if (found) return found;
    }
    return null;
  };
  return walk(doc.children, null, []);
};

export const findNode = (doc: PegoDocument, id: string): PegoNode | null =>
  findLocation(doc, id)?.node ?? null;

/** Every id in the subtree rooted at `node`, including its own. */
export const collectIds = (node: PegoNode, into = new Set<string>()): Set<string> => {
  into.add(node.id);
  if (isContainer(node)) for (const child of node.children) collectIds(child, into);
  return into;
};

export const collectDocIds = (doc: PegoDocument): Set<string> => {
  const ids = new Set<string>();
  for (const node of doc.children) collectIds(node, ids);
  return ids;
};

/** Copy-on-write: rebuild only the containers along `path`, then hand the list at its end to `fn`. */
const rebuildAt = (
  nodes: PegoNode[],
  path: number[],
  fn: (children: PegoNode[]) => PegoNode[],
): PegoNode[] => {
  const [head, ...rest] = path;
  if (head === undefined) return fn(nodes);
  const node = nodes[head];
  if (!node || !isContainer(node)) throw new Error(`no container at path index ${head}`);
  const next = nodes.slice();
  next[head] = { ...node, children: rebuildAt(node.children, rest, fn) };
  return next;
};

/** Children path of a container: `[]` for the document root, else the container's own path. */
export const childrenPath = (doc: PegoDocument, parentId: string | null): number[] | null => {
  if (parentId === null) return [];
  const loc = findLocation(doc, parentId);
  if (!loc || !isContainer(loc.node)) return null;
  return loc.path;
};

export const childrenAt = (doc: PegoDocument, parentId: string | null): PegoNode[] | null => {
  if (parentId === null) return doc.children;
  const node = findNode(doc, parentId);
  return node && isContainer(node) ? node.children : null;
};

export const updateChildrenAt = (
  doc: PegoDocument,
  path: number[],
  fn: (children: PegoNode[]) => PegoNode[],
): PegoDocument => ({
  ...doc,
  // Ops keep pages (and only pages) at the root.
  children: rebuildAt(doc.children, path, fn) as PageNode[],
});

/** The page a node lives on (a page is its own page); null for unknown ids. */
export const pageOf = (doc: PegoDocument, id: string): PageNode | null => {
  const loc = findLocation(doc, id);
  if (!loc) return null;
  return doc.children[loc.path[0]!] ?? null;
};

/** The page with this id, or the first page when the id is unknown or omitted. */
export const pageOrFirst = (doc: PegoDocument, pageId?: string | null): PageNode =>
  (pageId ? doc.children.find((page) => page.id === pageId) : undefined) ?? doc.children[0]!;

/** True when `id` is `ancestorId` itself or sits anywhere below it. */
export const isSelfOrDescendant = (doc: PegoDocument, ancestorId: string, id: string): boolean => {
  const ancestor = findNode(doc, ancestorId);
  return ancestor ? collectIds(ancestor).has(id) : false;
};
