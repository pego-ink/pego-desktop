import type { CanvasKit, Path, PathBuilder } from "canvaskit-wasm";
import { resolveNumber, type Layout, type PegoDocument, type PegoNode } from "@pego/doc";
import { getSvgPath } from "@/canvas/render-document";
import { findNodePath, nodeToDocAffine } from "@/canvas/node-transform";

/** The node's own geometry in its local space, as `drawContent` paints it. */
const localOutline = (
  ck: CanvasKit,
  doc: PegoDocument,
  node: PegoNode,
  w: number,
  h: number,
): PathBuilder | null => {
  if (node.type === "path") {
    const source = getSvgPath(ck, node.geometry);
    return source ? new ck.PathBuilder(source) : null;
  }
  const path = new ck.PathBuilder();
  switch (node.type) {
    case "ellipse":
      path.addOval(ck.XYWHRect(0, 0, w, h));
      return path;
    case "frame":
    case "rectangle":
    case "image": {
      const radius = resolveNumber(node.cornerRadius, doc.variables, 0);
      path.addRRect(ck.RRectXY(ck.XYWHRect(0, 0, w, h), radius, radius));
      return path;
    }
    default:
      path.addRect(ck.XYWHRect(0, 0, w, h));
      return path;
  }
};

/**
 * Outline of a node in document space with every ancestor transform applied. Independent of the
 * camera, so one build serves every pan/zoom. The caller owns the returned path (`.delete()`).
 */
export const buildNodeOutline = (
  ck: CanvasKit,
  doc: PegoDocument,
  layout: Layout,
  id: string,
): Path | null => {
  const nodes = findNodePath(doc, id);
  const node = nodes?.at(-1);
  const box = node && layout.get(id);
  if (!nodes || !node || !box) return null;
  const matrix = nodeToDocAffine(doc, layout, nodes);
  if (!matrix) return null;
  const builder = localOutline(ck, doc, node, box.width, box.height);
  if (!builder) return null;
  const { a, b, c, d, e, f } = matrix;
  builder.transform([a, c, e, b, d, f, 0, 0, 1]);
  return builder.detachAndDelete();
};
