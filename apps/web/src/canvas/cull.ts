import {
  MAX_INSTANCE_DEPTH,
  resolveInstance,
  resolveNumber,
  resolveStrokeWidth,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type Variables,
} from "@pego/doc";
import type { Camera } from "@/canvas/types";

/**
 * Viewport culling: the canvas skips layers whose paint cannot reach the visible area, so panning
 * a page with many screens draws only the few on screen. Bounds are conservative (shadows, blur,
 * strokes, markers, rotation, children overflowing an unclipped frame) and computed once per
 * layout; the per-frame test is one box intersection per layer.
 */

/** How far a node's own paint can reach outside its box. */
export const paintReach = (node: PegoNode, variables: Variables): number => {
  let reach = 0;
  if ("stroke" in node && node.stroke) {
    const width = resolveStrokeWidth(node.stroke.width, variables);
    // Path markers grow with the stroke (5x, at least 10).
    reach += node.type === "path" ? Math.max(10, width * 5) + width : width;
  }
  if ("effects" in node && node.effects) {
    for (const effect of node.effects) {
      if (effect.type === "blur") {
        reach += resolveNumber(effect.radius, variables, 0) * 3;
      } else if (!effect.inner) {
        reach +=
          Math.abs(resolveNumber(effect.x, variables, 0)) +
          Math.abs(resolveNumber(effect.y, variables, 0)) +
          resolveNumber(effect.blur, variables, 0) * 1.5 +
          Math.max(0, resolveNumber(effect.spread, variables, 0));
      }
    }
  }
  // Glyphs can overhang their measured box (italics, large ascenders).
  if (node.type === "text") reach += 8;
  // Arrow heads and the label pill.
  if (node.type === "connector") reach += 120;
  return reach;
};

const grow = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + by * 2,
  height: box.height + by * 2,
});

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

export const boxesTouch = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

/**
 * Document-space bounds of everything each rendered node paints, its subtree included (children
 * of an unclipped frame or group may paint outside it). Rotated or mirrored nodes get their
 * bounds grown by their diagonal, since layout boxes are before those transforms.
 */
export const computePaintBounds = (doc: PegoDocument, layout: Layout): Map<string, Box> => {
  const bounds = new Map<string, Box>();
  const visit = (raw: PegoNode, depth: number): Box | null => {
    const node = raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
    if (!node) return null;
    const box = layout.get(node.id);
    if (!box) return null;
    let paint = grow(box, paintReach(node, doc.variables));
    if (node.type === "frame" || node.type === "group") {
      const clipped = node.type === "frame" && node.clip === true;
      for (const child of node.children) {
        const inner = visit(child, depth + 1);
        if (inner && !clipped) paint = union(paint, inner);
      }
    }
    const turned =
      node.type !== "page" &&
      (resolveNumber(node.rotation, doc.variables, 0) !== 0 || node.flipX || node.flipY);
    if (turned) paint = grow(paint, Math.hypot(paint.width, paint.height));
    bounds.set(node.id, paint);
    return paint;
  };
  for (const page of doc.children) for (const node of page.children) visit(node, 0);
  return bounds;
};

const cache = new WeakMap<Layout, Map<string, Box>>();

/** `computePaintBounds`, memoized per layout (layouts are rebuilt on every document change). */
export const getPaintBounds = (doc: PegoDocument, layout: Layout): Map<string, Box> => {
  const cached = cache.get(layout);
  if (cached) return cached;
  const bounds = computePaintBounds(doc, layout);
  cache.set(layout, bounds);
  return bounds;
};

/** The document area a `width` x `height` (CSS px) view shows through `camera`. */
export const visibleArea = (camera: Camera, width: number, height: number): Box => ({
  x: -camera.panX / camera.zoom,
  y: -camera.panY / camera.zoom,
  width: width / camera.zoom,
  height: height / camera.zoom,
});
