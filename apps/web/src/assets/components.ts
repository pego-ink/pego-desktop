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
