import {
  cloneWithFreshIds,
  createId,
  findLocation,
  isContainer,
  resolveInstance,
  type Op,
  type PageNode,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";

/**
 * Libraries: the components of another project's design, copied onto a page of this document
 * ("Library · Name") so its instances work like local ones, and copied again on update. A
 * component keeps the same id in every copy (derived from the library and its id in the source),
 * so instances placed in this document survive an update.
 */

export type LibrarySource = { projectId: string; name: string; path: string };

const GAP = 80;

/** FNV-1a 32-bit hash of `text`, base36. */
const hash36 = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

/**
 * A short, id-safe, stable key for a library project: a readable prefix plus a hash of the whole
 * project id, so ids that sanitize or truncate alike (`a/b` vs `a_b`) still differ.
 */
export const libraryKey = (projectId: string) =>
  `${projectId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}${hash36(projectId)}`;

/** The id a source node gets in this document. */
export const libraryId = (projectId: string, sourceId: string) =>
  `lib_${libraryKey(projectId)}_${sourceId}`;

/** The pages of the document that hold libraries. */
export const libraryPages = (doc: PegoDocument): PageNode[] =>
  doc.children.filter((page) => page.library !== undefined);

const reusableIds = (nodes: readonly PegoNode[], into = new Set<string>()): Set<string> => {
  for (const node of nodes) {
    if (node.reusable === true) into.add(node.id);
    if (isContainer(node)) reusableIds(node.children, into);
  }
  return into;
};

/** Components not inside another component (the ones inside come along with them). */
const outermostComponents = (nodes: readonly PegoNode[], into: PegoNode[] = []): PegoNode[] => {
  for (const node of nodes) {
    if (node.reusable === true) into.push(node);
    else if (isContainer(node)) outermostComponents(node.children, into);
  }
  return into;
};

/**
 * A source subtree as it goes into the library page: ids mapped, instances of the library's own
 * components kept (pointing at the mapped ids). An instance whose component is missing becomes a
 * plain placeholder frame and a warning is recorded.
 */
const copyIn = (
  source: PegoDocument,
  node: PegoNode,
  projectId: string,
  components: Set<string>,
  warnings: string[],
): PegoNode => {
  if (node.type === "ref" && !components.has(node.ref)) {
    warnings.push(`Instance "${node.name ?? node.id}" points at a missing component (${node.ref})`);
    return {
      type: "frame",
      id: libraryId(projectId, node.id),
      name: node.name ?? "Missing component",
      x: node.x,
      y: node.y,
      width: typeof node.width === "number" ? node.width : 100,
      height: typeof node.height === "number" ? node.height : 100,
      layout: "none",
      children: [],
    } as PegoNode;
  }
  const map = (id: string) => libraryId(projectId, id);
  const mapped = { ...node, id: map(node.id) } as PegoNode;
  if (mapped.type === "ref" && node.type === "ref") {
    mapped.ref = map(node.ref);
    // Overrides are keyed by ids inside the component, which are mapped too; content an
    // instance put in a slot is copied in like everything else.
    if (node.descendants) {
      mapped.descendants = Object.fromEntries(
        Object.entries(node.descendants).map(([key, props]) => [
          map(key),
          Array.isArray(props.children)
            ? {
                ...props,
                children: (props.children as PegoNode[]).map((child) =>
                  copyIn(source, child, projectId, components, warnings),
                ),
              }
            : props,
        ]),
      );
    }
  }
  if (mapped.type === "frame" && node.type === "frame" && node.slot) {
    mapped.slot = node.slot.filter((id) => components.has(id)).map(map);
  }
  return isContainer(node) && isContainer(mapped)
    ? {
        ...mapped,
        children: node.children.map((child) =>
          copyIn(source, child, projectId, components, warnings),
        ),
      }
    : mapped;
};

/** Every instance in `nodes` whose component id is in `ids`. */
const instancesOf = (nodes: readonly PegoNode[], ids: Set<string>, into: PegoNode[] = []) => {
  for (const node of nodes) {
    if (node.type === "ref" && ids.has(node.ref)) into.push(node);
    if (isContainer(node)) instancesOf(node.children, ids, into);
  }
  return into;
};

/** Replace instances of `ids` outside `pageId` with plain copies (before those components go). */
const detachUsers = (doc: PegoDocument, pageId: string | null, ids: Set<string>): Op[] =>
  instancesOf(
    doc.children.filter((page) => page.id !== pageId),
    ids,
  ).flatMap((instance) => {
    const plain = instance.type === "ref" ? resolveInstance(doc, instance) : null;
    return plain
      ? [{ op: "replace" as const, id: instance.id, node: cloneWithFreshIds(plain) }]
      : [];
  });

/**
 * Add a library, or update it when this document has it already: its page gets the source's
 * components (in a row) and the document the variables they use that it does not have. On
 * update, instances of components the library no longer has become plain layers.
 */
export const syncLibraryOps = (
  doc: PegoDocument,
  source: PegoDocument,
  library: LibrarySource,
  now: number,
): {
  ops: Op[];
  pageId: string;
  count: number;
  /** Source variables whose name exists here with a different type or value (kept as they are). */
  conflicts: string[];
  warnings: string[];
} => {
  const components = reusableIds(source.children);
  const warnings: string[] = [];
  const copies = outermostComponents(source.children.flatMap((page) => page.children)).map((node) =>
    copyIn(source, node, library.projectId, components, warnings),
  );
  let x = 0;
  const placed = copies.map((node) => {
    const at = { ...node, x, y: 0 } as PegoNode;
    x += (typeof node.width === "number" ? node.width : 200) + GAP;
    return at;
  });

  const existing = doc.children.find((page) => page.library?.projectId === library.projectId);
  const pageId = existing?.id ?? createId();
  const page = {
    type: "page",
    id: pageId,
    name: `Library · ${library.name}`,
    x: 0,
    y: 0,
    library: { ...library, syncedAt: now },
    children: placed,
  } as PageNode;

  const ops: Op[] = [];
  if (existing) {
    const kept = reusableIds(placed);
    const gone = new Set([...reusableIds(existing.children)].filter((id) => !kept.has(id)));
    ops.push(...detachUsers(doc, existing.id, gone));
  }
  const missing = Object.entries(source.variables).filter(([name]) => !doc.variables[name]);
  const conflicts = Object.entries(source.variables)
    .filter(([name, variable]) => {
      const mine = doc.variables[name];
      return mine !== undefined && JSON.stringify(mine) !== JSON.stringify(variable);
    })
    .map(([name]) => name);
  if (missing.length > 0) ops.push({ op: "setVariables", variables: Object.fromEntries(missing) });
  ops.push(
    existing
      ? { op: "replace", id: existing.id, node: page }
      : { op: "insert", parentId: null, node: page },
  );
  return { ops, pageId, count: copies.length, conflicts, warnings };
};

/** Remove a library: its instances elsewhere become plain layers, then its page goes. */
export const removeLibraryOps = (doc: PegoDocument, pageId: string): Op[] => {
  const page = findLocation(doc, pageId)?.node;
  if (page?.type !== "page") return [];
  return [...detachUsers(doc, pageId, reusableIds(page.children)), { op: "delete", id: pageId }];
};
