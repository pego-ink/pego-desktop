import {
  findLocation,
  findNode,
  isContainer,
  type Box,
  type Layout,
  type Op,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { topmostSelected } from "./transform";
import { wrapSelection, type StructureResult } from "./structure";

/**
 * Add flex layout / Remove flex layout. Pure: each returns the ops to commit as one undo step, or
 * a reason it cannot run.
 */

export type FlexDirection = "horizontal" | "vertical";

const overlaps = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) > Math.max(a0, b0);

/**
 * Horizontal when most pairs of boxes sit side by side (their vertical ranges overlap and the
 * horizontal ones do not), vertical otherwise (also for a tie or a single box).
 */
export const inferDirection = (boxes: readonly Box[]): FlexDirection => {
  let sideBySide = 0;
  let stacked = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const xOverlap = overlaps(a.x, a.x + a.width, b.x, b.x + b.width);
      const yOverlap = overlaps(a.y, a.y + a.height, b.y, b.y + b.height);
      if (yOverlap && !xOverlap) sideBySide++;
      else if (xOverlap && !yOverlap) stacked++;
    }
  }
  return sideBySide > stacked ? "horizontal" : "vertical";
};

/** Indexes of `boxes` in reading order along the main axis (stable). */
export const orderAlong = (boxes: readonly Box[], direction: FlexDirection): number[] =>
  boxes
    .map((box, index) => ({ index, at: direction === "horizontal" ? box.x : box.y }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.index);

/** The typical (median) gap between neighbours along the main axis, rounded, never negative. */
export const inferGap = (boxes: readonly Box[], direction: FlexDirection): number => {
  const ordered = orderAlong(boxes, direction).map((index) => boxes[index]!);
  const gaps = ordered.slice(1).map((box, i) => {
    const prev = ordered[i]!;
    return direction === "horizontal"
      ? box.x - (prev.x + prev.width)
      : box.y - (prev.y + prev.height);
  });
  if (gaps.length === 0) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.max(0, Math.round(median));
};

/** [top, right, bottom, left] gaps between the children's union and the frame's box, rounded. */
export const inferPadding = (
  boxes: readonly Box[],
  frame: Box,
): [number, number, number, number] => {
  if (boxes.length === 0) return [0, 0, 0, 0];
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const clamp = (value: number) => Math.max(0, Math.round(value));
  return [
    clamp(top - frame.y),
    clamp(frame.x + frame.width - right),
    clamp(frame.y + frame.height - bottom),
    clamp(left - frame.x),
  ];
};

const sidesProp = (sides: [number, number, number, number]) =>
  sides.every((side) => side === sides[0]) ? sides[0] : sides;

const isFlex = (node: PegoNode) => node.type === "frame" && node.layout !== "none";

/** Moves that put the children `ids` of `parentId` in the order `order` (`order[to]` = from). */
const reorderOps = (parentId: string, ids: readonly string[], order: readonly number[]): Op[] => {
  const current = [...ids];
  const ops: Op[] = [];
  order.forEach((from, to) => {
    const id = ids[from]!;
    if (current[to] === id) return;
    current.splice(current.indexOf(id), 1);
    current.splice(to, 0, id);
    ops.push({ op: "move", id, parentId, index: to });
  });
  return ops;
};

/**
 * Add flex layout. One frame without layout: it gets a direction inferred from how its children
 * are arranged, a gap and padding inferred from their positions, and the children lose their x/y.
 * Anything else (several layers, a non-frame): the layers are wrapped in a new hugging frame with
 * that layout.
 */
export const addFlexLayout = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
): StructureResult => {
  const tops = topmostSelected(doc, ids).filter((id) => findNode(doc, id)?.type !== "page");
  if (tops.length === 0) return { error: "Select a layer to lay out." };
  const only = tops.length === 1 ? findNode(doc, tops[0]!) : null;

  if (only?.type === "frame") {
    if (only.layout !== "none") return { error: "This frame already has a flex layout." };
    const frameBox = layout.get(only.id);
    const shown = only.children.filter((child) => child.visible !== false && layout.has(child.id));
    if (!frameBox || shown.length === 0) {
      return {
        ops: [{ op: "update", id: only.id, props: { layout: "vertical" } }],
        select: [only.id],
        label: "Add flex layout",
      };
    }
    const boxes = shown.map((child) => layout.get(child.id)!);
    const direction = inferDirection(boxes);
    const order = orderAlong(boxes, direction);
    const ops: Op[] = [
      {
        op: "update",
        id: only.id,
        props: {
          layout: direction,
          gap: inferGap(boxes, direction),
          padding: sidesProp(inferPadding(boxes, frameBox)),
        },
      },
      ...only.children.map((child): Op => ({
        op: "update",
        id: child.id,
        props: { x: null, y: null },
      })),
      // Reorder only the shown children, keeping hidden ones where they are.
      ...reorderOps(
        only.id,
        only.children.map((child) => child.id),
        // Map the order of the shown children back onto child indexes.
        shownOrder(only.children, shown, order),
      ),
    ];
    return { ops, select: [only.id], label: "Add flex layout" };
  }

  const nodes = tops.flatMap((id) => findNode(doc, id) ?? []);
  const boxes = nodes.flatMap((node) => layout.get(node.id) ?? []);
  const direction = inferDirection(boxes);
  const wrapped = wrapSelection(doc, layout, tops, "frame", {
    layout: direction,
    gap: inferGap(boxes, direction),
    width: "fit_content",
    height: "fit_content",
  } as Partial<PegoNode>);
  if ("error" in wrapped) return wrapped;
  const frameId = wrapped.select[0]!;
  // wrapSelection moves the layers in document order; order them as they read on the canvas.
  const located = tops
    .flatMap((id) => findLocation(doc, id) ?? [])
    .sort((a, b) => a.index - b.index)
    .map((loc) => loc.node);
  const ordered = orderAlong(
    located.map((node) => layout.get(node.id) ?? { x: 0, y: 0, width: 0, height: 0 }),
    direction,
  );
  const ops: Op[] = [
    ...wrapped.ops,
    ...located.map((node): Op => ({ op: "update", id: node.id, props: { x: null, y: null } })),
    ...reorderOps(
      frameId,
      located.map((node) => node.id),
      ordered,
    ),
  ];
  return { ops, select: [frameId], label: "Add flex layout" };
};

/**
 * `order` ranks the shown children; returns a full permutation of `children` where the shown
 * ones appear in that order in the slots the shown children used to occupy.
 */
const shownOrder = (
  children: readonly PegoNode[],
  shown: readonly PegoNode[],
  order: readonly number[],
): number[] => {
  const shownIndexes = shown.map((child) => children.indexOf(child));
  const result = children.map((_, index) => index);
  order.forEach((shownRank, slot) => {
    result[shownIndexes[slot]!] = shownIndexes[shownRank]!;
  });
  return result;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Remove flex layout: each selected laid-out frame gets `layout: "none"`, and every child gets its
 * current computed box as x/y (fit/fill sizes become fixed numbers), so nothing moves. The frame's
 * own hug size is fixed too, or it would shrink to its children.
 */
export const removeFlexLayout = (
  doc: PegoDocument,
  layout: Layout,
  ids: readonly string[],
): StructureResult => {
  const frames = topmostSelected(doc, ids).flatMap((id) => {
    const node = findNode(doc, id);
    return node && isFlex(node) && isContainer(node) ? [node] : [];
  });
  if (frames.length === 0) return { error: "Select a frame with a flex layout." };
  const ops: Op[] = [];
  for (const frame of frames) {
    const frameBox = layout.get(frame.id);
    const frameProps: Record<string, unknown> = { layout: "none" };
    if (frameBox) {
      if (typeof frame.width !== "number") frameProps.width = round2(frameBox.width);
      if (typeof frame.height !== "number") frameProps.height = round2(frameBox.height);
    }
    ops.push({ op: "update", id: frame.id, props: frameProps });
    if (!frameBox) continue;
    for (const child of frame.children) {
      const box = layout.get(child.id);
      if (!box) continue;
      const props: Record<string, unknown> = {
        x: round2(box.x - frameBox.x),
        y: round2(box.y - frameBox.y),
      };
      // Text keeps hugging its content; only a fill needs a number once the layout is gone.
      const fixes = (size: unknown) =>
        child.type === "text" ? size === "fill_container" : typeof size !== "number";
      if (fixes(child.width)) props.width = round2(box.width);
      if (fixes(child.height) && child.type !== "text") props.height = round2(box.height);
      ops.push({ op: "update", id: child.id, props });
    }
  }
  return {
    ops,
    select: frames.map((frame) => frame.id),
    label: "Remove flex layout",
  };
};
