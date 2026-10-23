import type { Rect } from "@/canvas/agent-cursor-motion";

type Point = { x: number; y: number };

/** Gap in screen px between the "Generating" pill and the box (or a cursor) it avoids. */
export const GENERATING_GAP = 4;
const EDGE_MARGIN = 4;

/** Axis-aligned bounds of points (rotated node corners in screen space), or null when empty. */
export const boundsOfPoints = (points: readonly Point[]): Rect | null => {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Top-left of the run's "Generating" pill: just above the top-left of the focused boxes' union,
 * lifted above any agent cursor it would overlap and kept inside the canvas edge.
 */
export const placeGeneratingLabel = (
  union: Rect,
  size: { width: number; height: number },
  obstacles: readonly Rect[],
): Point => {
  const x = Math.max(EDGE_MARGIN, union.x);
  let y = union.y - size.height - GENERATING_GAP;
  // Each lift clears one obstacle for good (it only moves up), so this ends after one pass each.
  for (let pass = 0; pass < obstacles.length; pass++) {
    const hit = obstacles.find((o) => overlaps({ x, y, ...size }, o));
    if (!hit) break;
    y = hit.y - size.height - GENERATING_GAP;
  }
  return { x, y: Math.max(EDGE_MARGIN, y) };
};

/** Screen box of an agent cursor: its arrow plus the pill beside it (flipped to the left). */
export const cursorRect = (at: Point, pillWidth: number, flipped: boolean): Rect => {
  const left = flipped ? at.x + 10 - pillWidth : at.x;
  const right = flipped ? at.x + 20 : at.x + 14 + pillWidth;
  return { x: left, y: at.y, width: right - left, height: 18 + 22 };
};
