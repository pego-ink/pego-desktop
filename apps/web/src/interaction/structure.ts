import {
  cloneWithFreshIds,
  createId,
  findLocation,
  findNode,
  isContainer,
  resolveInstance,
  type Box,
  type Layout,
  type NodeLocation,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { topmostSelected } from "./transform";

/**
 * Structure actions of the canvas (shortcuts and the context menu): wrap the selection in a group
 * or frame, ungroup, make or detach components, detach instances, and stacking order. Pure: each
 * returns the ops to commit as one undo step and what to select after, or a reason it cannot run.
 */

export type StructurePlan = { ops: Op[]; select: string[]; label: string };
export type StructureResult = StructurePlan | { error: string };

const located = (doc: PegoDocument, ids: readonly string[]) =>
  topmostSelected(doc, ids)
    .flatMap((id) => {
      const loc = findLocation(doc, id);
      return loc && loc.node.type !== "page" ? [loc] : [];
    })
    .sort((a, b) => a.index - b.index);

/** Where a container's children are measured from: its box, or the page origin at the top. */
const originOf = (layout: Layout, parentId: string | null) => {
  const box = parentId ? layout.get(parentId) : undefined;
  return box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
};

const isFlexFrame = (node: PegoNode | null | undefined) =>
  node?.type === "frame" && node.layout !== "none";

const parentNode = (doc: PegoDocument, loc: NodeLocation) =>
  loc.parentId ? findNode(doc, loc.parentId) : null;

const union = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
};

/** "Frame 3": the next free number among the document's "Frame N" names. */
const nextFrameName = (doc: PegoDocument): string => {
  let max = 0;
  const walk = (nodes: readonly PegoNode[]) => {
    for (const node of nodes) {
      const match = /^Frame (\d+)$/.exec(node.name ?? "");
      if (match) max = Math.max(max, Number(match[1]));
      if (isContainer(node)) walk(node.children);
    }
  };
  walk(doc.children);
  return `Frame ${max + 1}`;
};

/**
 * Put the selection in a new group or frame, in place: the container takes the spot of the first
 * selected layer and the layers keep their positions on the canvas. The layers must share a
 * parent. A frame gets the selection's size, no fill and free (absolute) layout.
 */
export const wrapSelection = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
  kind: "group" | "frame",
  extra: Partial<PegoNode> = {},
): StructureResult => {
  const locs = located(doc, ids);
  if (locs.length === 0) return { error: "Select the layers to wrap first." };
  const parentId = locs[0]!.parentId;
  if (locs.some((loc) => loc.parentId !== parentId)) {
    return { error: "Select layers that sit in the same frame or group." };
  }
  const boxes = locs.flatMap((loc) => layout.get(loc.node.id) ?? []);
  if (boxes.length !== locs.length) return { error: "The selection has no size on the canvas." };
  const bounds = union(boxes);
  const origin = originOf(layout, parentId);
  const id = createId();
  const base = {
    id,
    x: Math.round(bounds.x - origin.x),
    y: Math.round(bounds.y - origin.y),
    children: [],
  };
  const container = (
    kind === "group"
      ? { ...base, type: "group", name: "Group" }
      : {
          ...base,
          type: "frame",
          name: nextFrameName(doc),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          layout: "none",
        }
  ) as PegoNode;
  const ops: Op[] = [
    {
      op: "insert",
      parentId,
      index: locs[0]!.index,
      node: { ...container, ...extra } as PegoNode,
    },
  ];
  locs.forEach((loc, index) => {
    const box = layout.get(loc.node.id)!;
    ops.push({ op: "move", id: loc.node.id, parentId: id, index });
    ops.push({
      op: "update",
      id: loc.node.id,
      props: { x: Math.round(box.x - bounds.x), y: Math.round(box.y - bounds.y) },
    });
  });
  return { ops, select: [id], label: kind === "group" ? "Group selection" : "Frame selection" };
};

/**
 * Take the children out of each selected group or frame, into its parent at its place, keeping
 * their positions on the canvas; the empty container is removed. Components are left alone.
 */
export const ungroupSelection = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
): StructureResult => {
  const containers = located(doc, ids).filter(
    (loc) => (loc.node.type === "group" || loc.node.type === "frame") && !loc.node.reusable,
  );
  if (containers.length === 0) return { error: "Select a group or frame to ungroup." };
  const ops: Op[] = [];
  const released: string[] = [];
  // Last first, so the indexes of the earlier containers stay valid.
  for (const loc of [...containers].reverse()) {
    const node = loc.node;
    if (!isContainer(node)) continue;
    const origin = originOf(layout, loc.parentId);
    const flexParent = isFlexFrame(parentNode(doc, loc));
    node.children.forEach((child, offset) => {
      ops.push({ op: "move", id: child.id, parentId: loc.parentId, index: loc.index + offset });
      const box = layout.get(child.id);
      if (box && !flexParent) {
        ops.push({
          op: "update",
          id: child.id,
          props: { x: Math.round(box.x - origin.x), y: Math.round(box.y - origin.y) },
        });
      }
      released.push(child.id);
    });
    ops.push({ op: "delete", id: node.id });
  }
  return { ops, select: released, label: "Ungroup" };
};

/** Every instance (ref) of `componentId` in the document. */
const instancesOf = (doc: PegoDocument, componentId: string): PegoNode[] => {
  const found: PegoNode[] = [];
  const walk = (nodes: readonly PegoNode[]) => {
    for (const node of nodes) {
      if (node.type === "ref" && node.ref === componentId) found.push(node);
      if (isContainer(node)) walk(node.children);
    }
  };
  walk(doc.children);
  return found;
};

/** Replace an instance with a plain copy of what it shows (overrides applied, fresh ids). */
const detachOp = (doc: PegoDocument, instance: PegoNode): Op | null => {
  if (instance.type !== "ref") return null;
  const expanded = resolveInstance(doc, instance);
  return expanded ? { op: "replace", id: instance.id, node: cloneWithFreshIds(expanded) } : null;
};

/** True when every selected layer is already a component (the toggle then detaches). */
export const allComponents = (doc: PegoDocument, ids: readonly string[]): boolean => {
  const locs = located(doc, ids);
  return locs.length > 0 && locs.every((loc) => loc.node.reusable === true);
};

/**
 * Create component / Detach component (one shortcut). Creating: one selected frame or group
 * becomes the component; anything else is first wrapped in a frame. Detaching: the components
 * become plain layers and their instances become plain copies, so nothing is left pointing at a
 * component that is gone.
 */
export const toggleComponent = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
): StructureResult => {
  const locs = located(doc, ids);
  if (locs.length === 0) return { error: "Select a layer to make a component." };
  if (allComponents(doc, ids)) {
    const ops: Op[] = [];
    for (const loc of locs) {
      for (const instance of instancesOf(doc, loc.node.id)) {
        const op = detachOp(doc, instance);
        if (op) ops.push(op);
      }
      ops.push({ op: "update", id: loc.node.id, props: { reusable: null } });
    }
    return { ops, select: locs.map((loc) => loc.node.id), label: "Detach component" };
  }
  const [only] = locs;
  if (locs.length === 1 && only && (only.node.type === "frame" || only.node.type === "group")) {
    return {
      ops: [{ op: "update", id: only.node.id, props: { reusable: true } }],
      select: [only.node.id],
      label: "Create component",
    };
  }
  const wrapped = wrapSelection(doc, layout, ids, "frame", {
    reusable: true,
    name: "Component",
  });
  return "error" in wrapped ? wrapped : { ...wrapped, label: "Create component" };
};

/** Detach instance: each selected instance becomes plain layers. */
export const detachInstances = (doc: PegoDocument, ids: readonly string[]): StructureResult => {
  const ops = located(doc, ids).flatMap((loc) => detachOp(doc, loc.node) ?? []);
  if (ops.length === 0) return { error: "Select a component instance to detach." };
  const select = ops.flatMap((op) => (op.op === "replace" ? [op.node.id] : []));
  return { ops, select, label: "Detach instance" };
};

/** The component an instance points at (for "Go to component"), or null. */
export const componentOf = (doc: PegoDocument, id: string): string | null => {
  const node = findNode(doc, id);
  if (node?.type !== "ref") return null;
  return findNode(doc, node.ref)?.reusable === true ? node.ref : null;
};

/** Bring to front / Send to back: the selection moves to the top or bottom of its parent. */
export const restack = (
  doc: PegoDocument,
  ids: readonly string[],
  where: "front" | "back",
): StructureResult => {
  const locs = located(doc, ids);
  if (locs.length === 0) return { error: "Select layers to move." };
  const ops: Op[] = [];
  const ordered = where === "front" ? locs : [...locs].reverse();
  for (const loc of ordered) {
    const siblings = loc.parentId
      ? (findNode(doc, loc.parentId) as { children?: PegoNode[] } | null)?.children
      : null;
    const count = siblings?.length ?? doc.children.length;
    ops.push({
      op: "move",
      id: loc.node.id,
      parentId: loc.parentId,
      ...(where === "front" ? { index: count - 1 } : { index: 0 }),
    });
  }
  return {
    ops,
    select: locs.map((loc) => loc.node.id),
    label: where === "front" ? "Bring to front" : "Send to back",
  };
};
