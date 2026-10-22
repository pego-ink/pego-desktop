import type { Box, Layout, PegoDocument } from "@pego/doc";
import {
  applyAffine,
  findNodePath,
  invertAffine,
  nodeToDocAffine,
  type Affine,
} from "@/canvas/node-transform";
import type { Camera } from "@/canvas/types";
import { HANDLES, handlePoint, resizeBox, type Handle } from "./transform";

type Point = { x: number; y: number };

/**
 * A node as selection chrome sees it: its own width x height box in local space (origin =
 * top-left) plus the matrices that place it, so rotation of the node and of every ancestor is
 * honoured by the outline, the handles and the resize math.
 */
export type SelectionFrame = {
  /** Local -> document. */
  matrix: Affine;
  /** The parent's local -> document (identity for top-level nodes). */
  parentMatrix: Affine;
  /** The node's layout box (document coordinates, as `layout` reports it). */
  box: Box;
};

const frameCache = new WeakMap<PegoDocument, WeakMap<Layout, Map<string, SelectionFrame | null>>>();

const buildFrame = (doc: PegoDocument, layout: Layout, id: string): SelectionFrame | null => {
  const box = layout.get(id);
  const path = findNodePath(doc, id);
  if (!box || !path) return null;
  const matrix = nodeToDocAffine(doc, layout, path);
  const parentMatrix = nodeToDocAffine(doc, layout, path.slice(0, -1));
  return matrix && parentMatrix ? { matrix, parentMatrix, box } : null;
};

/** Frame of `id`, cached per (doc, layout) so pointer moves and redraws do not re-walk the tree. */
export const getSelectionFrame = (
  doc: PegoDocument,
  layout: Layout,
  id: string,
): SelectionFrame | null => {
  let byLayout = frameCache.get(doc);
  if (!byLayout) frameCache.set(doc, (byLayout = new WeakMap()));
  let byId = byLayout.get(layout);
  if (!byId) byLayout.set(layout, (byId = new Map()));
  if (byId.has(id)) return byId.get(id) ?? null;
  const frame = buildFrame(doc, layout, id);
  byId.set(id, frame);
  return frame;
};

/** `m` (local -> document) followed by the camera: local -> screen. */
export const toScreenMatrix = (camera: Camera, m: Affine): Affine => ({
  a: m.a * camera.zoom,
  b: m.b * camera.zoom,
  c: m.c * camera.zoom,
  d: m.d * camera.zoom,
  e: m.e * camera.zoom + camera.panX,
  f: m.f * camera.zoom + camera.panY,
});

/** Corners nw, ne, se, sw of a width x height local box under `m`. */
export const frameCorners = (m: Affine, width: number, height: number): Point[] =>
  [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => applyAffine(m, x!, y!));

/** Position of `handle` on the box under `m`. */
export const frameHandlePoint = (
  m: Affine,
  width: number,
  height: number,
  handle: Handle,
): Point => {
  const local = handlePoint({ x: 0, y: 0, width, height }, handle);
  return applyAffine(m, local.x, local.y);
};

/** Unit vectors of the local x and y axes in the target space (zoom divided out). */
export const frameAxes = (m: Affine): { ux: Point; uy: Point } => {
  const sx = Math.hypot(m.a, m.b) || 1;
  const sy = Math.hypot(m.c, m.d) || 1;
  return { ux: { x: m.a / sx, y: m.b / sx }, uy: { x: m.c / sy, y: m.d / sy } };
};

/**
 * Handle whose rotated square (half side `radius`, aligned to the node's axes like the drawn
 * handle) contains the screen point, or null. `m` is local -> screen.
 */
export const hitFrameHandle = (
  m: Affine,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): Handle | null => {
  const { ux, uy } = frameAxes(m);
  for (const handle of HANDLES) {
    const p = frameHandlePoint(m, width, height, handle);
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.abs(dx * ux.x + dy * ux.y) <= radius && Math.abs(dx * uy.x + dy * uy.y) <= radius)
      return handle;
  }
  return null;
};

const AXIS_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** Resize cursor for `handle`: its outward direction on screen snapped to the nearest 45 degrees. */
export const frameHandleCursor = (m: Affine, handle: Handle): string => {
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const angle = (Math.atan2(m.b * sx + m.d * sy, m.a * sx + m.c * sy) * 180) / Math.PI;
  // Cursors are double-ended, so only the axis matters: fold into [0, 180) then snap.
  const axis = ((angle % 180) + 180) % 180;
  return AXIS_CURSORS[Math.round(axis / 45) % 4]!;
};

/** Where the size label goes: centered under the lowest point of the (rotated) box. */
export const labelAnchor = (corners: readonly Point[]): Point => {
  const xs = corners.map((c) => c.x);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...corners.map((c) => c.y)) };
};

/** The corner that is topmost on screen (leftmost on ties), where the agent tag sits. */
export const topmostCorner = (corners: readonly Point[]): Point =>
  corners.reduce((best, c) =>
    c.y < best.y - 1e-6 || (Math.abs(c.y - best.y) <= 1e-6 && c.x < best.x) ? c : best,
  );

/** Apply only the linear part of `m` (a direction, not a position). */
const mapVector = (m: Affine, x: number, y: number): Point => ({
  x: m.a * x + m.c * y,
  y: m.b * x + m.d * y,
});

/**
 * Resize by dragging `handle` with a document-space pointer delta. The delta is converted into the
 * node's local axes, resized there (so the opposite edge stays put), and the moved origin is mapped
 * into the parent's local space. Returns a box in the same convention as `resizeBox` for
 * `resizeOps`: width/height are final, `x - frame.box.x` / `y - frame.box.y` is the shift to add to
 * the node's own x/y.
 */
export const resizeFrame = (
  frame: SelectionFrame,
  handle: Handle,
  dx: number,
  dy: number,
  opts: { shift?: boolean; alt?: boolean; snap?: boolean } = {},
): Box => {
  const inverse = invertAffine(frame.matrix);
  const parentInverse = invertAffine(frame.parentMatrix);
  if (!inverse || !parentInverse) return frame.box;
  const local = mapVector(inverse, dx, dy);
  const next = resizeBox(
    { x: 0, y: 0, width: frame.box.width, height: frame.box.height },
    handle,
    local.x,
    local.y,
    opts,
  );
  const inDoc = mapVector(frame.matrix, next.x, next.y);
  const shift = mapVector(parentInverse, inDoc.x, inDoc.y);
  return {
    x: frame.box.x + shift.x,
    y: frame.box.y + shift.y,
    width: next.width,
    height: next.height,
  };
};
