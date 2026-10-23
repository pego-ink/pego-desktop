import { createId, isContainer, type InsertOp, type PegoDocument, type PegoNode } from "@pego/doc";

/** A reusable node (component) of the document and the page it lives on. */
export type ComponentEntry = { id: string; name: string; pageId: string; pageName: string };

const listCache = new WeakMap<PegoDocument, ComponentEntry[]>();
const indexCache = new WeakMap<PegoDocument, ReadonlyMap<string, PegoNode>>();

/** Every node of the document by id, built once per document object (documents are immutable). */
export const nodeIndex = (doc: PegoDocument): ReadonlyMap<string, PegoNode> => {
  const cached = indexCache.get(doc);
  if (cached) return cached;
  const index = new Map<string, PegoNode>();
  const walk = (nodes: readonly PegoNode[]) => {
    for (const node of nodes) {
      index.set(node.id, node);
      if (isContainer(node)) walk(node.children);
    }
  };
  walk(doc.children);
  indexCache.set(doc, index);
  return index;
};

/** Every component of the document, page by page, in tree order (computed once per document). */
export const listComponents = (doc: PegoDocument): ComponentEntry[] => {
  const cached = listCache.get(doc);
  if (cached) return cached;
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
  listCache.set(doc, found);
  return found;
};

/**
 * `next` with the previous entry objects reused where nothing changed (and `prev` itself when
 * the whole list is the same), so memoized cards skip re-rendering on unrelated edits.
 */
export const reuseEntries = (
  prev: readonly ComponentEntry[],
  next: ComponentEntry[],
): readonly ComponentEntry[] => {
  const before = new Map(prev.map((entry) => [entry.id, entry]));
  const merged = next.map((entry) => {
    const old = before.get(entry.id);
    return old &&
      old.name === entry.name &&
      old.pageId === entry.pageId &&
      old.pageName === entry.pageName
      ? old
      : entry;
  });
  const same = merged.length === prev.length && merged.every((entry, i) => entry === prev[i]);
  return same ? prev : merged;
};

let lastEntries: readonly ComponentEntry[] = [];

/** `listComponents` with entry objects reused across documents (see `reuseEntries`). */
export const stableComponents = (doc: PegoDocument): readonly ComponentEntry[] => {
  lastEntries = reuseEntries(lastEntries, listComponents(doc));
  return lastEntries;
};

/** The ids a subtree points at with `ref` nodes. */
const refTargets = (node: PegoNode, into: string[] = []): string[] => {
  if (node.type === "ref") into.push(node.ref);
  if (isContainer(node)) for (const child of node.children) refTargets(child, into);
  return into;
};

/**
 * The reusable nodes `id` renders through its refs, following the chain (nested instances), not
 * including `id` itself. Missing targets are skipped; cycles end.
 */
export const referencedComponents = (doc: PegoDocument, id: string): PegoNode[] => {
  const index = nodeIndex(doc);
  const seen = new Set([id]);
  const found: PegoNode[] = [];
  const queue = [id];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const node = index.get(next);
    if (!node) continue;
    for (const target of refTargets(node)) {
      const referenced = index.get(target);
      if (!referenced || seen.has(target)) continue;
      seen.add(target);
      found.push(referenced);
      queue.push(target);
    }
  }
  return found;
};

/**
 * Whether an instance of `componentId` may be inserted into `parentId` without a cycle: the
 * parent must not be the component, sit inside it, or sit inside a component it instantiates
 * (that component would then contain an instance of the one that contains it).
 */
export const canNestInstance = (
  doc: PegoDocument,
  componentId: string,
  parentId: string,
): boolean => {
  const index = nodeIndex(doc);
  const blocked = new Set([
    componentId,
    ...referencedComponents(doc, componentId).map((n) => n.id),
  ]);
  const climb = (nodes: readonly PegoNode[], trail: boolean): boolean | null => {
    for (const node of nodes) {
      const inBlocked = trail || blocked.has(node.id);
      if (node.id === parentId) return !inBlocked;
      if (isContainer(node)) {
        const result = climb(node.children, inBlocked);
        if (result !== null) return result;
      }
    }
    return null;
  };
  if (!index.has(parentId)) return false;
  return climb(doc.children, false) ?? false;
};

/** Deepest frame of a hit path that can take an instance of `componentId`, or null (the page). */
export const deepestNestableFrameId = (
  doc: PegoDocument,
  path: readonly string[] | null,
  componentId: string,
): string | null => {
  if (!path) return null;
  const index = nodeIndex(doc);
  for (let i = path.length - 1; i >= 0; i--) {
    const id = path[i];
    if (id === undefined || index.get(id)?.type !== "frame") continue;
    if (canNestInstance(doc, componentId, id)) return id;
  }
  return null;
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

/** Drag data of a component dragged from the Assets panel onto the canvas. */
export const COMPONENT_MIME = "application/x-pego-component";

/** Components of one page (a library page shows the library's name). */
export type ComponentSection = {
  pageId: string;
  title: string;
  library: boolean;
  entries: ComponentEntry[];
};

/** Lowercase without accents, for matching typed words. */
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Components grouped by page, in page order, keeping those whose name has every typed word
 * (case and accents ignored). Pages with none left are dropped.
 */
export const componentSections = (
  doc: PegoDocument,
  entries: readonly ComponentEntry[],
  query: string,
): ComponentSection[] => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = (entry: ComponentEntry) => {
    const name = fold(entry.name);
    return words.every((word) => name.includes(word));
  };
  return doc.children.flatMap((page): ComponentSection[] => {
    const list = entries.filter((entry) => entry.pageId === page.id && matches(entry));
    if (list.length === 0) return [];
    return [
      {
        pageId: page.id,
        title: page.library ? page.library.name : page.name,
        library: page.library !== undefined,
        entries: list,
      },
    ];
  });
};

/**
 * An instance of `component` dropped at canvas point `at`: centered there, inside the deepest
 * frame under the point (`frameId`, with its box), else at the top level of the page.
 */
export const dropInstanceOp = (
  component: Pick<ComponentEntry, "id" | "name">,
  size: { width: number; height: number },
  at: { x: number; y: number },
  pageId: string,
  frame: { id: string; x: number; y: number } | null,
): InsertOp => {
  const op = instanceOp(component, pageId, {
    x: at.x - size.width / 2 - (frame?.x ?? 0),
    y: at.y - size.height / 2 - (frame?.y ?? 0),
  });
  return frame ? { ...op, parentId: frame.id } : op;
};
