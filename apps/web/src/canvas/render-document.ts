import type {
  Canvas as SkCanvas,
  CanvasKit,
  Image as SkImage,
  Paint,
  Path,
  Shader,
} from "canvaskit-wasm";
import {
  imageFitRect,
  pageOrFirst,
  linearGradientPoints,
  MAX_INSTANCE_DEPTH,
  flipOf,
  resolveColor,
  resolveInstance,
  resolveNumber,
  resolveSides,
  type Box,
  type Effect,
  type Fill,
  type Layout,
  type PathNode,
  type PegoDocument,
  type PegoNode,
  type ShadowEffect,
  findRenderedNode,
} from "@pego/doc";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { getIconPath } from "@/canvas/icons";
import { nodePlacement } from "@/canvas/node-transform";
import { getParagraph } from "@/canvas/measure-text";
import { createLruCache } from "@/canvas/render-cache";
import { drawImageNode } from "@/canvas/render-image-node";
import { strokePathWithExtras } from "@/canvas/render-path-extras";
import type { Camera } from "@/canvas/types";

type Paints = { fill: Paint; stroke: Paint; layer: Paint; iconStroke: Paint; effect: Paint };

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
const shaders = createLruCache<Shader>(128);
/** Decoded fill images by data URI; `id` keeps shader cache keys short. */
const images = new Map<string, { image: SkImage | null; id: number }>();
const MAX_IMAGES = 64;
let nextImageId = 1;

const decodeImage = (ck: CanvasKit, src: string) => {
  const cached = images.get(src);
  if (cached) return cached;
  let image: SkImage | null;
  try {
    const base64 = src.slice(src.indexOf(",") + 1);
    image = ck.MakeImageFromEncoded(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  } catch {
    image = null;
  }
  const entry = { image, id: nextImageId++ };
  images.set(src, entry);
  if (images.size > MAX_IMAGES) {
    const [oldest] = images;
    if (oldest) {
      oldest[1].image?.delete();
      images.delete(oldest[0]);
    }
  }
  return entry;
};

/** Shader for a gradient or image fill sized to the node's box; null when it cannot be drawn. */
const fillShader = (
  scene: Scene,
  fill: Exclude<Fill, string>,
  width: number,
  height: number,
): Shader | null => {
  const { ck } = scene.res;
  const { variables } = scene.doc;
  if (fill.type === "image") {
    const { image, id } = decodeImage(ck, fill.src);
    if (!image) return null;
    const key = `image:${id}:${fill.fit}:${width}x${height}`;
    const cached = shaders.get(key);
    if (cached) return cached;
    const rect = imageFitRect(fill.fit, image.width(), image.height(), width, height);
    const sx = rect.width / image.width();
    const sy = rect.height / image.height();
    const shader = image.makeShaderOptions(
      ck.TileMode.Decal,
      ck.TileMode.Decal,
      ck.FilterMode.Linear,
      ck.MipmapMode.None,
      [sx, 0, rect.x, 0, sy, rect.y, 0, 0, 1],
    );
    shaders.set(key, shader);
    return shader;
  }
  const colors = fill.stops.map((stop) => resolveColor(stop.color, variables) ?? "#00000000");
  const positions = fill.stops.map((stop) => stop.position);
  const angle = fill.type === "linear" ? resolveNumber(fill.angle, variables, 180) : 0;
  const key = JSON.stringify([
    fill.type,
    angle,
    fill.type === "radial" ? [fill.center, fill.radius] : 0,
    colors,
    positions,
    width,
    height,
  ]);
  const cached = shaders.get(key);
  if (cached) return cached;
  const skColors = colors.map((color) => ck.parseColorString(color));
  let shader: Shader;
  if (fill.type === "linear") {
    const { start, end } = linearGradientPoints(angle, width, height);
    shader = ck.Shader.MakeLinearGradient(
      [start.x, start.y],
      [end.x, end.y],
      skColors,
      positions,
      ck.TileMode.Clamp,
    );
  } else {
    // A unit circle at the origin, stretched to the ellipse radii and moved to the center.
    const [cx, cy] = fill.center;
    const [rx, ry] = fill.radius;
    shader = ck.Shader.MakeRadialGradient([0, 0], 1, skColors, positions, ck.TileMode.Clamp, [
      Math.max(rx * width, 0.001),
      0,
      cx * width,
      0,
      Math.max(ry * height, 0.001),
      cy * height,
      0,
      0,
      1,
    ]);
  }
  shaders.set(key, shader);
  return shader;
};

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
  const paints = {
    fill: make("fill"),
    stroke: make("stroke"),
    layer: new ck.Paint(),
    iconStroke,
    effect: make("fill"),
  };
  paintsByKit.set(ck, paints);
  return paints;
};

/**
 * The node's geometry, scaled from its `viewBox` to the box size when it has one. Shared with the
 * hover outline; callers must copy before mutating.
 */
export const getSvgPath = (
  ck: CanvasKit,
  node: Pick<PathNode, "geometry" | "viewBox">,
  box: Pick<Box, "width" | "height">,
): Path | null => {
  const { geometry, viewBox } = node;
  const scaled = viewBox && viewBox[2] > 0 && viewBox[3] > 0;
  const key = scaled ? JSON.stringify([geometry, viewBox, box.width, box.height]) : geometry;
  const cached = svgPaths.get(key);
  if (cached) return cached;
  const base = ck.Path.MakeFromSVGString(geometry);
  if (!base) return null;
  let path = base;
  if (scaled) {
    const [minX, minY, vbWidth, vbHeight] = viewBox;
    const sx = box.width / vbWidth;
    const sy = box.height / vbHeight;
    path = new ck.PathBuilder(base)
      .transform([sx, 0, -minX * sx, 0, sy, -minY * sy, 0, 0, 1])
      .detachAndDelete();
    base.delete();
  }
  svgPaths.set(key, path);
  return path;
};

/** CSS blur radius to Skia sigma. */
const sigmaOf = (blur: number) => Math.max(0, blur) / 2;

type ResolvedShadow = {
  inner: boolean;
  color: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
};

const resolveShadows = (scene: Scene, effects: Effect[] | undefined): ResolvedShadow[] => {
  if (!effects) return [];
  const { variables } = scene.doc;
  return effects.flatMap((effect) => {
    if (effect.type !== "shadow") return [];
    const color = resolveColor(effect.color, variables);
    if (!color) return [];
    const shadow: ShadowEffect = effect;
    return [
      {
        inner: shadow.inner ?? false,
        color,
        x: resolveNumber(shadow.x, variables, 0),
        y: resolveNumber(shadow.y, variables, 0),
        blur: resolveNumber(shadow.blur, variables, 0),
        spread: resolveNumber(shadow.spread, variables, 0),
      },
    ];
  });
};

/** Sum of the layer blur radii; 0 when the node has none. */
const layerBlurOf = (scene: Scene, node: PegoNode): number => {
  if (!("effects" in node) || !node.effects) return 0;
  return node.effects.reduce(
    (sum, effect) =>
      effect.type === "blur" ? sum + resolveNumber(effect.radius, scene.doc.variables, 0) : sum,
    0,
  );
};

/** A box shape: corner radius, or an ellipse. */
type BoxShape = { width: number; height: number; radius: number; ellipse: boolean };

/** The shape grown (or shrunk, for negative `by`) on every side and moved by dx/dy, as an rrect. */
const inflate = (ck: CanvasKit, shape: BoxShape, by: number, dx = 0, dy = 0) => {
  const width = Math.max(0, shape.width + by * 2);
  const height = Math.max(0, shape.height + by * 2);
  const rect = ck.XYWHRect(dx - by, dy - by, width, height);
  if (shape.ellipse) return ck.RRectXY(rect, width / 2, height / 2);
  const r = Math.max(0, shape.radius + by);
  return ck.RRectXY(rect, r, r);
};

const withBlur = (scene: Scene, blur: number, draw: (paint: Paint) => void) => {
  const { ck } = scene.res;
  const paint = scene.paints.effect;
  const filter = blur > 0 ? ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, sigmaOf(blur), true) : null;
  paint.setMaskFilter(filter);
  draw(paint);
  paint.setMaskFilter(null);
  filter?.delete();
};

/** Drop shadows of a box shape (frames, rectangles, ellipses), drawn behind its fill. */
const drawOuterShadows = (scene: Scene, shadows: ResolvedShadow[], shape: BoxShape) => {
  const { ck } = scene.res;
  for (const shadow of shadows) {
    if (shadow.inner) continue;
    withBlur(scene, shadow.blur, (paint) => {
      paint.setColor(ck.parseColorString(shadow.color));
      scene.canvas.drawRRect(inflate(ck, shape, shadow.spread, shadow.x, shadow.y), paint);
    });
  }
};

/** Inner shadows of a box shape, clipped to it, drawn over the fill. */
const drawInnerShadows = (scene: Scene, shadows: ResolvedShadow[], shape: BoxShape) => {
  const { ck } = scene.res;
  const { canvas } = scene;
  for (const shadow of shadows) {
    if (!shadow.inner) continue;
    canvas.save();
    canvas.clipRRect(inflate(ck, shape, 0), ck.ClipOp.Intersect, true);
    withBlur(scene, shadow.blur, (paint) => {
      paint.setColor(ck.parseColorString(shadow.color));
      // A ring around the hole: everything outside the shifted, shrunk shape casts inward.
      const margin = shadow.blur * 2 + Math.abs(shadow.x) + Math.abs(shadow.y) + 1;
      const outer = inflate(ck, { ...shape, radius: 0, ellipse: false }, margin);
      const hole = inflate(ck, shape, -shadow.spread, shadow.x, shadow.y);
      canvas.drawDRRect(outer, hole, paint);
    });
    canvas.restore();
  }
};

/** Shadows of arbitrary content (text, icons, paths): a shadow-only layer per shadow, then the content. */
const drawWithContentShadows = (scene: Scene, shadows: ResolvedShadow[], draw: () => void) => {
  const { ck } = scene.res;
  const { canvas, paints } = scene;
  for (const shadow of shadows) {
    if (shadow.inner) continue;
    const sigma = sigmaOf(shadow.blur);
    const filter = ck.ImageFilter.MakeDropShadowOnly(
      shadow.x,
      shadow.y,
      sigma,
      sigma,
      ck.parseColorString(shadow.color),
      null,
    );
    paints.layer.setAlphaf(1);
    paints.layer.setImageFilter(filter);
    canvas.saveLayer(paints.layer);
    paints.layer.setImageFilter(null);
    filter.delete();
    draw();
    canvas.restore();
  }
  draw();
};

/** Fill with a color, gradient or image laid out over a `width` x `height` box. */
const fillWith = (
  scene: Scene,
  fill: Fill | undefined,
  width: number,
  height: number,
  draw: (paint: Paint) => void,
) => {
  if (fill === undefined) return;
  const { ck } = scene.res;
  const paint = scene.paints.fill;
  if (typeof fill === "string") {
    const color = resolveColor(fill, scene.doc.variables);
    if (!color) return;
    paint.setColor(ck.parseColorString(color));
    draw(paint);
    return;
  }
  const shader = fillShader(scene, fill, width, height);
  if (!shader) return;
  paint.setColor(ck.BLACK);
  paint.setShader(shader);
  draw(paint);
  paint.setShader(null);
};

/**
 * Stroke the node's outline. A uniform width is centered on the outline. Per-side widths
 * (`[top, right, bottom, left]`) are drawn inside the box edges like a CSS border when the node
 * is a box (`box` given), and as one centered stroke of the widest side otherwise.
 */
const strokeWith = (
  scene: Scene,
  node: PegoNode,
  draw: (paint: Paint) => void,
  shape?: BoxShape,
) => {
  if (!("stroke" in node) || !node.stroke) return;
  const { variables } = scene.doc;
  const { ck } = scene.res;
  const color = resolveColor(node.stroke.color, variables);
  if (!color) return;
  const [top, right, bottom, left] = resolveSides(node.stroke.width, variables, 1).map((w) =>
    Math.max(0, w),
  ) as [number, number, number, number];
  const uniform = top === right && right === bottom && bottom === left;
  if (!uniform && shape) {
    const { canvas, paints } = scene;
    const { width, height } = shape;
    paints.fill.setColor(ck.parseColorString(color));
    canvas.save();
    canvas.clipRRect(inflate(ck, shape, 0), ck.ClipOp.Intersect, true);
    if (top > 0) canvas.drawRect(ck.XYWHRect(0, 0, width, top), paints.fill);
    if (bottom > 0) canvas.drawRect(ck.XYWHRect(0, height - bottom, width, bottom), paints.fill);
    if (left > 0) canvas.drawRect(ck.XYWHRect(0, 0, left, height), paints.fill);
    if (right > 0) canvas.drawRect(ck.XYWHRect(width - right, 0, right, height), paints.fill);
    canvas.restore();
    return;
  }
  const width = Math.max(top, right, bottom, left);
  if (width <= 0) return;
  const { stroke } = scene.paints;
  stroke.setColor(ck.parseColorString(color));
  stroke.setStrokeWidth(width);
  draw(stroke);
};

/** Draw the node's own content in its local space (origin = box top-left). */
const drawContent = (scene: Scene, node: PegoNode, box: Box) => {
  const { res, canvas, doc, paints } = scene;
  const { ck } = res;
  const { width, height } = box;
  const fill = "fill" in node ? node.fill : undefined;
  const shadows = resolveShadows(scene, "effects" in node ? node.effects : undefined);

  switch (node.type) {
    case "frame":
    case "rectangle":
    case "ellipse": {
      // Ellipses are rounded rects with radii of half the size.
      const shape: BoxShape = {
        width,
        height,
        radius: node.type === "ellipse" ? 0 : resolveNumber(node.cornerRadius, doc.variables, 0),
        ellipse: node.type === "ellipse",
      };
      const rrect = inflate(ck, shape, 0);
      drawOuterShadows(scene, shadows, shape);
      fillWith(scene, fill, width, height, (paint) => canvas.drawRRect(rrect, paint));
      drawInnerShadows(scene, shadows, shape);
      strokeWith(scene, node, (paint) => canvas.drawRRect(rrect, paint), shape);
      return;
    }
    case "path": {
      const path = getSvgPath(ck, node, box);
      if (!path) return;
      drawWithContentShadows(scene, shadows, () => {
        fillWith(scene, fill, width, height, (paint) => canvas.drawPath(path, paint));
        // Caps, joins and start/end markers ride on the stroke paint's width.
        strokeWith(scene, node, (paint) =>
          strokePathWithExtras(ck, canvas, path, paint, node, paint.getStrokeWidth()),
        );
      });
      return;
    }
    case "text": {
      // Same rule as computeLayout: wrap when the width is fixed or given by the parent.
      const wraps = typeof node.width === "number" || node.width === "fill_container";
      const wrapWidth = wraps ? width : undefined;
      const paragraph = getParagraph(res, node, doc.variables, wrapWidth);
      drawWithContentShadows(scene, shadows, () => canvas.drawParagraph(paragraph, 0, 0));
      return;
    }
    case "icon": {
      const path = getIconPath(ck, node.iconName);
      if (!path || width <= 0 || height <= 0) return;
      const color = typeof fill === "string" ? resolveColor(fill, doc.variables) : undefined;
      paints.iconStroke.setColor(ck.parseColorString(color ?? DEFAULT_ICON_COLOR));
      drawWithContentShadows(scene, shadows, () => {
        canvas.save();
        canvas.scale(width / ICON_VIEWBOX, height / ICON_VIEWBOX);
        canvas.drawPath(path, paints.iconStroke);
        canvas.restore();
      });
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
    const placement = nodePlacement(box, parent, rotation);
    canvas.translate(placement.x, placement.y);
    if (placement.angle !== 0) canvas.rotate(placement.angle, 0, 0);
    // Mirror around the box center, after the rotation (rotate, then flip, like CSS
    // `rotate() scale(-1, 1)`): the box stays put, content, children and shadows mirror.
    const flip = flipOf(node);
    if (flip.x || flip.y) {
      canvas.translate(box.width / 2, box.height / 2);
      canvas.scale(flip.x ? -1 : 1, flip.y ? -1 : 1);
      canvas.translate(-box.width / 2, -box.height / 2);
    }
    if (opacity < 1) {
      paints.layer.setAlphaf(opacity);
      canvas.saveLayer(paints.layer);
    }
    const blur = layerBlurOf(scene, node);
    if (blur > 0) {
      // CSS `filter: blur(r)` takes the standard deviation itself, unlike shadow blur radii.
      const sigma = blur;
      const filter = res.ck.ImageFilter.MakeBlur(sigma, sigma, res.ck.TileMode.Decal, null);
      paints.layer.setAlphaf(1);
      paints.layer.setImageFilter(filter);
      canvas.saveLayer(paints.layer);
      paints.layer.setImageFilter(null);
      filter.delete();
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

    if (blur > 0) canvas.restore();
    if (opacity < 1) canvas.restore();
    canvas.restore();
  }
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
    /** Canvas background; null leaves it transparent (exports). Defaults to the editor's. */
    background?: string | null;
    /** Page to draw (null/omitted = the first page). */
    pageId?: string | null;
  } = {},
) => {
  const background = options.background === undefined ? BACKGROUND : options.background;
  canvas.clear(background === null ? res.ck.TRANSPARENT : res.ck.parseColorString(background));
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
    drawNodes(scene, pageOrFirst(doc, options.pageId).children, ORIGIN, 0);
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
