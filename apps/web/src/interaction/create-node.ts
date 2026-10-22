import {
  type Box,
  findNode,
  isContainer,
  type Layout,
  type Op,
  pageOrFirst,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";

export type DrawTool = "frame" | "rectangle" | "ellipse";

export const DEFAULT_SIZES: Record<DrawTool, { width: number; height: number }> = {
  frame: { width: 400, height: 300 },
  rectangle: { width: 100, height: 100 },
  ellipse: { width: 100, height: 100 },
};

const BASE_NAMES: Record<DrawTool, string> = {
  frame: "Frame",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
};

const DEFAULT_FILLS: Record<DrawTool, string> = {
  frame: "#FFFFFF",
  rectangle: "#D9D9D9",
  ellipse: "#D9D9D9",
};

const childrenOf = (doc: PegoDocument, parentId: string | null): readonly PegoNode[] => {
  if (parentId === null) return doc.children;
  const node = findNode(doc, parentId);
  return node && isContainer(node) ? node.children : [];
};

export const createLabel = (tool: DrawTool) => `Create ${BASE_NAMES[tool].toLowerCase()}`;

/** `Rectangle`, or `Rectangle 2`, `Rectangle 3`... when the name is already used among siblings. */
export const uniqueName = (base: string, siblings: readonly PegoNode[]): string => {
  const taken = new Set(siblings.map((n) => n.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
};

const round = (v: number) => Math.round(v);

/**
 * Box dragged from `start` to `end` (doc coords). shift = square, alt = `start` is the center.
 * Whole numbers, at least 1x1.
 */
export const drawBox = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  opts: { shift?: boolean; alt?: boolean } = {},
): Box => {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (opts.shift) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  const x1 = opts.alt ? start.x - dx : start.x;
  const y1 = opts.alt ? start.y - dy : start.y;
  const x2 = start.x + dx;
  const y2 = start.y + dy;
  return {
    x: round(Math.min(x1, x2)),
    y: round(Math.min(y1, y2)),
    width: Math.max(1, round(Math.abs(x2 - x1))),
    height: Math.max(1, round(Math.abs(y2 - y1))),
  };
};

/** Box for a click without drag: default size, top-left at the click point. */
export const clickBox = (tool: DrawTool, point: { x: number; y: number }): Box => ({
  x: round(point.x),
  y: round(point.y),
  ...DEFAULT_SIZES[tool],
});

/** Where a new node goes: parent id (null = top level), parent-relative origin, flex flag. */
export type Placement = {
  parentId: string | null;
  originX: number;
  originY: number;
  flex: boolean;
};

/** Deepest frame in a hit path `[topLevelId, ..., deepestId]`, or null. */
export const deepestFrameId = (
  doc: PegoDocument,
  path: readonly string[] | null,
): string | null => {
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const id = path[i];
    if (id !== undefined && findNode(doc, id)?.type === "frame") return id;
  }
  return null;
};

export const resolvePlacement = (
  doc: PegoDocument,
  layout: Layout,
  path: readonly string[] | null,
  /** Page the canvas shows (null = the first): outside any frame, nodes go on it. */
  pageId: string | null = null,
): Placement => {
  const parentId = deepestFrameId(doc, path);
  if (!parentId) {
    return { parentId: pageOrFirst(doc, pageId).id, originX: 0, originY: 0, flex: false };
  }
  const box = layout.get(parentId);
  const parent = findNode(doc, parentId);
  return {
    parentId,
    originX: box?.x ?? 0,
    originY: box?.y ?? 0,
    flex: parent?.type === "frame" && parent.layout !== "none",
  };
};

/** Position of a doc-space point inside the placement's parent. */
export const toParentSpace = (placement: Placement, x: number, y: number) => ({
  x: round(x - placement.originX),
  y: round(y - placement.originY),
});

export const buildNode = (
  doc: PegoDocument,
  tool: DrawTool,
  id: string,
  placement: Placement,
  box: Box,
): PegoNode => {
  const siblings = childrenOf(doc, placement.parentId);
  const common = {
    id,
    name: uniqueName(BASE_NAMES[tool], siblings),
    width: box.width,
    height: box.height,
    fill: DEFAULT_FILLS[tool],
    ...(placement.flex ? {} : { ...toParentSpace(placement, box.x, box.y) }),
  };
  return tool === "frame"
    ? { type: "frame", layout: "none", children: [], x: 0, y: 0, ...common }
    : { type: tool, x: 0, y: 0, ...common };
};

/** Insert op for a new node. In a flex parent it is appended as last child with size only. */
export const createNodeOp = (
  doc: PegoDocument,
  tool: DrawTool,
  id: string,
  placement: Placement,
  box: Box,
): Op => ({
  op: "insert",
  parentId: placement.parentId,
  node: buildNode(doc, tool, id, placement, box),
});

/** Update op that resizes/moves the node while drawing (size only in a flex parent). */
export const drawUpdateOps = (id: string, placement: Placement, box: Box): Op[] => [
  {
    op: "update",
    id,
    props: placement.flex
      ? { width: box.width, height: box.height }
      : { ...toParentSpace(placement, box.x, box.y), width: box.width, height: box.height },
  },
];
