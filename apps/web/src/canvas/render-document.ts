import type { Canvas as SkCanvas, CanvasKit, Paint, Path } from "canvaskit-wasm";
import {
  MAX_INSTANCE_DEPTH,
  resolveColor,
  resolveInstance,
  resolveNumber,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
  walkRendered,
} from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { getIconPath } from "@/canvas/icons";
import { getParagraph } from "@/canvas/measure-text";
import { createLruCache } from "@/canvas/render-cache";
import { drawImageNode } from "@/canvas/render-image-node";
import { strokePathWithExtras } from "@/canvas/render-path-extras";
import type { Camera } from "@/canvas/types";

type Paints = { fill: Paint; stroke: Paint; layer: Paint; iconStroke: Paint };

type Scene = {
  res: CanvasKitResources;
  canvas: SkCanvas;
  doc: PegoDocument;
  layout: Layout;
  paints: Paints;
  hiddenIds: ReadonlySet<string>;
};

const BACKGROUND = "#141418";
const ICON_VIEWBOX = 24;
const ICON_STROKE_WIDTH = 2;
const DEFAULT_ICON_COLOR = "#FFFFFF";

const paintsByKit = new WeakMap<CanvasKit, Paints>();
const svgPaths = createLruCache<Path>(256);

const getPaints = (ck: CanvasKit): Paints => {
  const cached = paintsByKit.get(ck);
  if (cached) return cached;
  const make = (style: "fill" | "stroke") => {
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(style === "fill" ? ck.PaintStyle.Fill : ck.PaintStyle.Stroke);
    return paint;
  };
  const iconStroke = make("stroke");
  iconStroke.setStrokeCap(ck.StrokeCap.Round);
  iconStroke.setStrokeJoin(ck.StrokeJoin.Round);
  iconStroke.setStrokeWidth(ICON_STROKE_WIDTH);
  const paints = { fill: make("fill"), stroke: make("stroke"), layer: new ck.Paint(), iconStroke };
  paintsByKit.set(ck, paints);
  return paints;
};

const getSvgPath = (ck: CanvasKit, geometry: string): Path | null => {
  const cached = svgPaths.get(geometry);
  if (cached) return cached;
  const path = ck.Path.MakeFromSVGString(geometry);
  if (path) svgPaths.set(geometry, path);
  return path;
};

const fillWith = (scene: Scene, color: string | undefined, draw: (paint: Paint) => void) => {
  if (!color) return;
  const { fill } = scene.paints;
  fill.setColor(scene.res.ck.parseColorString(color));
  draw(fill);
};

const strokeWith = (scene: Scene, node: PegoNode, draw: (paint: Paint) => void) => {
  if (!("stroke" in node) || !node.stroke) return;
  const { variables } = scene.doc;
  const color = resolveColor(node.stroke.color, variables);
  const width = resolveNumber(node.stroke.width, variables, 1);
  if (!color || width <= 0) return;
  const { stroke } = scene.paints;
  stroke.setColor(scene.res.ck.parseColorString(color));
  stroke.setStrokeWidth(width);
  draw(stroke);
};

/** Draw the node's own content in its local space (origin = box top-left). */
const drawContent = (scene: Scene, node: PegoNode, box: Box) => {
  const { res, canvas, doc, paints } = scene;
  const { ck } = res;
  const { width, height } = box;
  const fill = "fill" in node ? resolveColor(node.fill, doc.variables) : undefined;

  switch (node.type) {
    case "frame":
    case "rectangle": {
      const radius = resolveNumber(node.cornerRadius, doc.variables, 0);
      const rrect = ck.RRectXY(ck.XYWHRect(0, 0, width, height), radius, radius);
      fillWith(scene, fill, (paint) => canvas.drawRRect(rrect, paint));
      strokeWith(scene, node, (paint) => canvas.drawRRect(rrect, paint));
      return;
    }
    case "ellipse": {
      const oval = ck.XYWHRect(0, 0, width, height);
      fillWith(scene, fill, (paint) => canvas.drawOval(oval, paint));
      strokeWith(scene, node, (paint) => canvas.drawOval(oval, paint));
      return;
    }
    case "path": {
      const path = getSvgPath(ck, node.geometry);
      if (!path) return;
      fillWith(scene, fill, (paint) => canvas.drawPath(path, paint));
      strokeWith(scene, node, (paint) =>
        strokePathWithExtras(
          ck,
          canvas,
          path,
          paint,
          node,
          resolveNumber(node.stroke?.width, doc.variables, 1),
        ),
      );
      return;
    }
    case "text": {
      // Same rule as computeLayout: wrap when the width is fixed or given by the parent.
      const wraps = typeof node.width === "number" || node.width === "fill_container";
      const wrapWidth = wraps ? width : undefined;
      canvas.drawParagraph(getParagraph(res, node, doc.variables, wrapWidth), 0, 0);
      return;
    }
    case "icon": {
      const path = getIconPath(ck, node.iconName);
      if (!path || width <= 0 || height <= 0) return;
      paints.iconStroke.setColor(ck.parseColorString(fill ?? DEFAULT_ICON_COLOR));
      canvas.save();
      canvas.scale(width / ICON_VIEWBOX, height / ICON_VIEWBOX);
      canvas.drawPath(path, paints.iconStroke);
      canvas.restore();
      return;
    }
    case "image":
      drawImageNode(res, canvas, node, box, doc.variables);
      return;
    default:
      return;
  }
};

const drawNodes = (scene: Scene, nodes: readonly PegoNode[], parent: Box, depth: number) => {
  const { canvas, doc, layout, paints, res } = scene;
  for (const raw of nodes) {
    const node = raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
    if (!node || scene.hiddenIds.has(node.id)) continue;
    const box = layout.get(node.id);
    if (!box) continue;

    const opacity = Math.min(1, Math.max(0, resolveNumber(node.opacity, doc.variables, 1)));
    const rotation = resolveNumber(node.rotation, doc.variables, 0);

    canvas.save();
    canvas.translate(box.x - parent.x, box.y - parent.y);
    if (rotation !== 0) canvas.rotate(-rotation, 0, 0);
    if (opacity < 1) {
      paints.layer.setAlphaf(opacity);
      canvas.saveLayer(paints.layer);
    }

    drawContent(scene, node, box);

    if (node.type === "frame" || node.type === "group") {
      canvas.save();
      if (node.type === "frame" && node.clip) {
        const radius = resolveNumber(node.cornerRadius, doc.variables, 0);
        const rrect = res.ck.RRectXY(res.ck.XYWHRect(0, 0, box.width, box.height), radius, radius);
        canvas.clipRRect(rrect, res.ck.ClipOp.Intersect, true);
      }
      drawNodes(scene, node.children, box, depth + 1);
      canvas.restore();
    }

    if (opacity < 1) canvas.restore();
    canvas.restore();
  }
};

/** The expanded (refs resolved) node with this id, including instance descendants. */
export const findRenderedNode = (doc: PegoDocument, id: string): PegoNode | null => {
  let found: PegoNode | null = null;
  walkRendered(doc, doc.children, (node) => {
    if (found) return false;
    if (node.id !== id) return;
    found = node;
    return false;
  });
  return found;
};

/**
 * Draw the document through `camera`. The canvas is expected to already be scaled by
 * devicePixelRatio by the caller. `layout` holds the absolute box of every rendered node.
 */
export const renderDocument = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  doc: PegoDocument,
  layout: Layout,
  camera: Camera,
  options: {
    /** Nodes not drawn, e.g. the text node being edited in the DOM overlay. */
    hiddenIds?: ReadonlySet<string>;
    /**
     * Draw only this node's subtree, upright with its top-left at the document origin (so the
     * camera pan places it). Ancestors' transforms, clips and opacity are NOT applied: the
     * result is the node itself, independent of where its parents sit or crop it. The node's own
     * opacity, clip and corner radius still apply. Draws nothing for an unknown id.
     */
    rootId?: string;
    /** Backdrop around the frames (the canvas follows the app theme); default the dark one. */
    background?: string;
  } = {},
) => {
  canvas.clear(res.ck.parseColorString(options.background ?? BACKGROUND));
  canvas.save();
  canvas.translate(camera.panX, camera.panY);
  canvas.scale(camera.zoom, camera.zoom);
  const scene: Scene = {
    res,
    canvas,
    doc,
    layout,
    paints: getPaints(res.ck),
    hiddenIds: options.hiddenIds ?? NO_HIDDEN_IDS,
  };
  if (options.rootId === undefined) {
    drawNodes(scene, doc.children, ORIGIN, 0);
  } else {
    const root = findRenderedNode(doc, options.rootId);
    const box = root && layout.get(root.id);
    // The node is already expanded (not a ref); rotation is dropped so it stays on the surface.
    if (root && box) drawNodes(scene, [{ ...root, rotation: 0 } as PegoNode], box, 0);
  }
  canvas.restore();
};

const NO_HIDDEN_IDS: ReadonlySet<string> = new Set();
const ORIGIN: Box = { x: 0, y: 0, width: 0, height: 0 };
