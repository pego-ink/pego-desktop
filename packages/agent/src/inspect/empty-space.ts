import type { Box, Layout, PegoDocument } from "@pego/doc";

export type Direction = "right" | "below" | "left" | "above";

export type PlacementRequest = {
  width: number;
  height: number;
  nearNodeId?: string;
  direction?: Direction;
  padding?: number;
};

export type Placement = Box & { direction: Direction; anchor: string };

const overlaps = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

/** Where the candidate must move to clear `blocker` when sliding in `direction`. */
const clear = (candidate: Box, blocker: Box, direction: Direction, padding: number): Box => {
  switch (direction) {
    case "right":
      return { ...candidate, x: blocker.x + blocker.width + padding };
    case "left":
      return { ...candidate, x: blocker.x - padding - candidate.width };
    case "below":
      return { ...candidate, y: blocker.y + blocker.height + padding };
    case "above":
      return { ...candidate, y: blocker.y - padding - candidate.height };
  }
};

const union = (boxes: Box[]): Box => {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const startNear = (anchor: Box, size: Box, direction: Direction, padding: number): Box => {
  switch (direction) {
    case "right":
      return { ...size, x: anchor.x + anchor.width + padding, y: anchor.y };
    case "left":
      return { ...size, x: anchor.x - padding - size.width, y: anchor.y };
    case "below":
      return { ...size, x: anchor.x, y: anchor.y + anchor.height + padding };
    case "above":
      return { ...size, x: anchor.x, y: anchor.y - padding - size.height };
  }
};

/**
 * A spot for a new top-level frame that overlaps no existing top-level node and keeps `padding`
 * of space around it. Starts next to `nearNodeId` (or next to everything on the canvas) in the
 * wanted direction, then slides past any node it still collides with.
 */
export const findEmptySpace = (
  doc: PegoDocument,
  layout: Layout,
  request: PlacementRequest,
): Placement => {
  const direction = request.direction ?? "right";
  const padding = request.padding ?? 80;
  const occupied = doc.children
    .map((node) => layout.get(node.id))
    .filter((box): box is Box => box !== undefined);
  const size: Box = { x: 0, y: 0, width: request.width, height: request.height };

  if (occupied.length === 0) return { ...size, direction, anchor: "origin" };

  const near = request.nearNodeId ? layout.get(request.nearNodeId) : undefined;
  if (request.nearNodeId && !near) {
    throw new Error(`node "${request.nearNodeId}" has no box in the layout`);
  }
  const anchor = near ?? union(occupied);
  let candidate = startNear(anchor, size, direction, padding);

  // Each step moves strictly past one blocker in `direction`, so this terminates.
  for (let guard = 0; guard <= occupied.length * 4 + 4; guard++) {
    const blocker = occupied.find((box) => overlaps(candidate, box, padding));
    if (!blocker) break;
    candidate = clear(candidate, blocker, direction, padding);
  }
  return { ...candidate, direction, anchor: request.nearNodeId ?? "canvas" };
};
