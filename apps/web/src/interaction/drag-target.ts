import {
  findLocation,
  findNode,
  isContainer,
  pageOf,
  resolveNumber,
  type Layout,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import {
  applyAffine,
  findNodePath,
  invertAffine,
  nodeToDocAffine,
  IDENTITY,
  type Affine,
} from "@/canvas/node-transform";
import { getNodeIndex, hitPath } from "./hit-test";
import { roundPx } from "./snap";
import { moveOps, topmostSelected } from "./transform";

export type Point = { x: number; y: number };
/** Line segment in document coordinates. */
export type Segment = { x1: number; y1: number; x2: number; y2: number };

export type DragPlan = {
  ops: Op[];
  /** Auto-layout frame the dragged nodes sit in after `ops` (drives the insertion line), else null. */
  flexParentId: string | null;
};

const isFlexFrame = (node: PegoNode | null): boolean =>
  node?.type === "frame" && node.layout !== "none";

/** Parent-local -> document matrix; the document root is the identity. */
const parentAffine = (
  doc: PegoDocument,
  layout: Layout,
  parentId: string | null,
): Affine | null => {
  if (parentId === null) return IDENTITY;
  const path = findNodePath(doc, parentId);
  return path ? nodeToDocAffine(doc, layout, path) : null;
};

/** Document point -> the parent's local space (rotation-aware), or null when not invertible. */
const toParentLocal = (
  doc: PegoDocument,
  layout: Layout,
  parentId: string | null,
  p: Point,
): Point | null => {
  const m = parentAffine(doc, layout, parentId);
  const inverse = m && invertAffine(m);
  return inverse ? applyAffine(inverse, p.x, p.y) : null;
};

const pointInParent = (doc: PegoDocument, layout: Layout, parentId: string, p: Point): boolean => {
  const box = layout.get(parentId);
  const local = box && toParentLocal(doc, layout, parentId, p);
  if (!box || !local) return false;
  return local.x >= 0 && local.x <= box.width && local.y >= 0 && local.y <= box.height;
};

/**
 * Parent the dragged nodes should live in for a pointer at `point` (document coords); null is the
 * document root. A flex frame or group parent keeps its children while the pointer is inside its
 * box (so hovering a sibling frame reorders instead of nesting). Otherwise it is the deepest
 * frame under the pointer, ignoring the dragged nodes and their subtrees, or the root.
 */
export const resolveDropParent = (
  doc: PegoDocument,
  layout: Layout,
  point: Point,
  dragged: readonly string[],
  currentParentId: string | null,
): string | null => {
  const current = currentParentId ? findNode(doc, currentParentId) : null;
  if (
    current &&
    (current.type === "group" || isFlexFrame(current)) &&
    pointInParent(doc, layout, current.id, point)
  )
    return current.id;

  // The dragged nodes sit on the shown page: only its nodes are drop targets.
  const pageId = dragged[0] === undefined ? null : (pageOf(doc, dragged[0])?.id ?? null);
  const chain = hitPath(doc, layout, point.x, point.y, { skip: new Set(dragged), pageId }) ?? [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const id = chain[i];
    if (id && getNodeIndex(doc).get(id)?.type === "frame") return id;
  }
  return null;
};

/**
 * True when putting `dragged` into `parentId` would make an instance contain its own component
 * (a `ref` in the dragged subtrees pointing at `parentId` or one of its ancestors).
 */
export const wouldNestComponent = (
  doc: PegoDocument,
  dragged: readonly string[],
  parentId: string | null,
): boolean => {
  if (parentId === null) return false;
  const index = getNodeIndex(doc);
  const ancestors = new Set<string>();
  for (let id: string | null = parentId; id; id = index.get(id)?.parentId ?? null)
    ancestors.add(id);
  const visit = (node: PegoNode): boolean =>
    (node.type === "ref" && ancestors.has(node.ref)) ||
    (isContainer(node) && node.children.some(visit));
  return dragged.some((id) => {
    const node = findNode(doc, id);
    return node ? visit(node) : false;
  });
};

/**
 * Slot (index among the parent's children, dragged ones excluded) for a pointer over an
 * auto-layout frame: the number of remaining children whose main-axis midpoint is before it.
 */
export const slotIndex = (
  doc: PegoDocument,
  layout: Layout,
  parentId: string,
  point: Point,
  dragged: ReadonlySet<string>,
): number => {
  const parent = findNode(doc, parentId);
  const parentBox = layout.get(parentId);
  const local = toParentLocal(doc, layout, parentId, point);
  if (!parent || parent.type !== "frame" || !parentBox || !local) return 0;
  const horizontal = parent.layout === "horizontal";
  const pointer = horizontal ? local.x : local.y;
  return parent.children.reduce((count, child) => {
    const box = layout.get(child.id);
    if (!box || dragged.has(child.id)) return count;
    const mid = horizontal
      ? box.x - parentBox.x + box.width / 2
      : box.y - parentBox.y + box.height / 2;
    return mid < pointer ? count + 1 : count;
  }, 0);
};

/**
 * Move ops that leave `ordered` as one contiguous block at `slot` of `parentId`'s children
 * (dragged ones excluded from the slot count). Skips moves that would change nothing, so a
 * drag that stays on the same slot adds no ops to the undo step.
 */
export const reorderOps = (
  doc: PegoDocument,
  parentId: string,
  ordered: readonly string[],
  slot: number,
): Op[] => {
  const parent = findNode(doc, parentId);
  if (!parent || !isContainer(parent)) return [];
  const dragged = new Set(ordered);
  const anchor = parent.children.filter((c) => !dragged.has(c.id))[slot]?.id;
  let list = parent.children.map((c) => c.id);
  const ops: Op[] = [];
  ordered.forEach((id, k) => {
    const without = list.filter((x) => x !== id);
    const prev = ordered[k - 1];
    const index =
      prev !== undefined
        ? without.indexOf(prev) + 1
        : anchor === undefined
          ? without.length
          : without.indexOf(anchor);
    if (list.indexOf(id) !== index) ops.push({ op: "move", id, parentId, index });
    list = [...without.slice(0, index), id, ...without.slice(index)];
  });
  return ops;
};

/**
 * 2px insertion line for dragged nodes sitting in an auto-layout frame: at the leading edge of
 * the first dragged node (centred in the gap when it has a previous sibling), spanning the
 * frame's cross axis. Document coordinates; null when the frame or node is not laid out.
 */
export const insertionLine = (
  doc: PegoDocument,
  layout: Layout,
  parentId: string,
  ordered: readonly string[],
): Segment | null => {
  const parent = findNode(doc, parentId);
  const parentBox = layout.get(parentId);
  const m = parentAffine(doc, layout, parentId);
  const first = ordered[0] && layout.get(ordered[0]);
  if (!parent || parent.type !== "frame" || parent.layout === "none") return null;
  if (!parentBox || !m || !first) return null;
  const horizontal = parent.layout === "horizontal";
  const siblings = parent.children;
  const hasPrev = siblings.findIndex((c) => c.id === ordered[0]) > 0;
  const gap = resolveNumber(parent.gap, doc.variables, 0);
  const edge = horizontal ? first.x - parentBox.x : first.y - parentBox.y;
  const at = Math.max(0, hasPrev ? edge - gap / 2 : edge);
  const [from, to] = horizontal
    ? [applyAffine(m, at, 0), applyAffine(m, at, parentBox.height)]
    : [applyAffine(m, 0, at), applyAffine(m, parentBox.width, at)];
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
};

/** The ids that are direct children of `parentId`, in document order. */
export const childrenAmong = (
  doc: PegoDocument,
  parentId: string,
  ids: readonly string[],
): string[] => {
  const parent = findNode(doc, parentId);
  if (!parent || !isContainer(parent)) return [];
  return parent.children.map((c) => c.id).filter((id) => ids.includes(id));
};

export const sameSegment = (a: Segment | null, b: Segment | null): boolean =>
  a === b || (!!a && !!b && a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2);

export type DragInput = {
  /** Document at gesture start (after any alt-duplicate inserts). */
  startDoc: PegoDocument;
  startLayout: Layout;
  /** Current document and layout, including earlier ops of this drag. */
  doc: PegoDocument;
  layout: Layout;
  ids: readonly string[];
  /** Pointer in document coords. */
  point: Point;
  /** Pointer travel since gesture start in document units (axis constraint already applied). */
  dx: number;
  dy: number;
  snap: boolean;
};

/**
 * Ops for one pointermove of a move drag, computed against the current document so they can be
 * folded into the drag's single undo step.
 *
 * Selections whose topmost nodes share one parent get the Figma-like behaviour: inside an
 * auto-layout parent they reorder as a block along its main axis; leaving it (or leaving any frame)
 * reparents the block to the deepest frame under the pointer or the root. Free targets keep each
 * node's on-screen position and follow the pointer; auto-layout targets insert at the pointer's
 * slot. Selections spanning several parents just move free nodes (flex children stay put).
 */
export const planDrag = (input: DragInput): DragPlan => {
  const { startDoc, startLayout, doc, layout, point, dx, dy, snap } = input;
  const fallback: DragPlan = {
    ops: moveOps(startDoc, input.ids, dx, dy, snap),
    flexParentId: null,
  };

  const index = getNodeIndex(doc);
  const tops = topmostSelected(doc, input.ids);
  const parents = tops.map((id) => index.get(id)?.parentId ?? null);
  const first = tops[0];
  if (first === undefined) return { ops: [], flexParentId: null };
  if (!parents.every((p) => p === parents[0])) return fallback;

  const currentParent = parents[0] ?? null;
  const origParent = getNodeIndex(startDoc).get(first)?.parentId ?? null;
  let target = resolveDropParent(doc, layout, point, tops, currentParent);
  if (wouldNestComponent(doc, tops, target)) target = currentParent;

  const children = (() => {
    // null = the top level of the page the nodes are on.
    const parent = currentParent ? findNode(doc, currentParent) : pageOf(doc, first);
    return parent && isContainer(parent) ? parent.children : [];
  })();
  const ordered = [...tops].sort(
    (a, b) => children.findIndex((c) => c.id === a) - children.findIndex((c) => c.id === b),
  );

  // Ops name the page for the top level (null in the node index), so they apply on any page.
  const opParent = target ?? pageOf(doc, first)?.id ?? null;
  const targetNode = target ? findNode(doc, target) : null;
  if (isFlexFrame(targetNode) && target) {
    const slot = slotIndex(doc, layout, target, point, new Set(tops));
    return { ops: reorderOps(doc, target, ordered, slot), flexParentId: target };
  }

  // Free target (root, `layout: "none"` frame, or the group the nodes already sit in).
  if (target === origParent) {
    const back: Op[] =
      currentParent === target
        ? []
        : [...ordered]
            .map((id) => ({ id, at: findLocation(startDoc, id)?.index }))
            .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
            .map(({ id, at }): Op => ({ op: "move", id, parentId: opParent, index: at }));
    return { ops: [...back, ...moveOps(startDoc, tops, dx, dy, snap)], flexParentId: null };
  }

  const targetInverse = (() => {
    const m = parentAffine(doc, layout, target);
    return m && invertAffine(m);
  })();
  if (!targetInverse) return { ops: [], flexParentId: null };
  const place = ordered.flatMap((id): Op[] => {
    const path = findNodePath(startDoc, id);
    const origin = path && nodeToDocAffine(startDoc, startLayout, path, false);
    if (!origin) return [];
    const local = applyAffine(targetInverse, origin.e + dx, origin.f + dy);
    return [{ op: "update", id, props: { x: roundPx(local.x, snap), y: roundPx(local.y, snap) } }];
  });
  const reparent: Op[] =
    currentParent === target
      ? []
      : ordered.map((id): Op => ({ op: "move", id, parentId: opParent }));
  return { ops: [...reparent, ...place], flexParentId: null };
};
