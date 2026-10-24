import { createId, nodeSchema, type PegoNode } from "@pego/doc";

/**
 * Figma (REST API JSON, fetched with `geometry=paths`) to Pego nodes. Pure: no network. Frames,
 * groups, auto layout, shapes, vectors, text, fills (solid, gradients, images), strokes and
 * effects are converted; what Pego cannot represent is reported as a warning, never thrown.
 */

type Rgba = { r: number; g: number; b: number; a?: number };
type Vec = { x: number; y: number };

export type FigmaPaint = {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: Rgba;
  gradientHandlePositions?: Vec[];
  gradientStops?: { color: Rgba; position: number }[];
  imageRef?: string;
  scaleMode?: string;
};

export type FigmaEffect = {
  type: string;
  visible?: boolean;
  radius?: number;
  color?: Rgba;
  offset?: Vec;
  spread?: number;
};

export type FigmaNode = {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  size?: Vec;
  relativeTransform?: number[][];
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  effects?: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  clipsContent?: boolean;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  layoutWrap?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  layoutPositioning?: string;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    italic?: boolean;
    lineHeightPx?: number;
    lineHeightUnit?: string;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };
  characterStyleOverrides?: number[];
  textAutoResize?: string;
  fillGeometry?: { path: string }[];
  strokeGeometry?: { path: string }[];
};

export type FigmaConversion = { nodes: PegoNode[]; warnings: string[]; count: number };

type Box = { x: number; y: number; width: number; height: number };

type Ctx = {
  /** imageRef -> data URI (or https URL as a last resort). */
  images: ReadonlyMap<string, string>;
  warnings: Set<string>;
  count: number;
  max: number;
};

/** Most nodes one import creates. */
export const MAX_FIGMA_NODES = 5000;

const round = (value: number) => Math.round(value * 100) / 100;

const hex = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");

/** A Figma color (0..1 channels) with extra opacity as #rrggbb or #rrggbbaa. */
export const figmaColor = (color: Rgba, opacity = 1): string => {
  const alpha = (color.a ?? 1) * opacity;
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}${alpha < 1 ? hex(alpha) : ""}`;
};

const visible = <T extends { visible?: boolean }>(list: readonly T[] | undefined): T[] =>
  (list ?? []).filter((item) => item.visible !== false);

/** Figma gradient handles (fractions of the box) as a CSS-like angle: 0 up, 90 right. */
const gradientAngle = (handles: Vec[], box: Box): number => {
  const [from, to] = handles;
  if (!from || !to) return 180;
  const dx = (to.x - from.x) * box.width;
  const dy = (to.y - from.y) * box.height;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return round((degrees + 360) % 360);
};

/** The top visible paint as a Pego fill, or undefined. */
const fillOf = (paints: FigmaPaint[] | undefined, box: Box, ctx: Ctx): unknown => {
  const shown = visible(paints);
  if (shown.length > 1) ctx.warnings.add("layers with several fills keep only the top one");
  const paint = shown.at(-1);
  if (!paint) return undefined;
  const stops = () =>
    (paint.gradientStops ?? []).map((stop) => ({
      color: figmaColor(stop.color, paint.opacity),
      position: Math.min(1, Math.max(0, round(stop.position))),
    }));
  switch (paint.type) {
    case "SOLID":
      return paint.color ? figmaColor(paint.color, paint.opacity) : undefined;
    case "GRADIENT_LINEAR":
      return {
        type: "linear",
        angle: gradientAngle(paint.gradientHandlePositions ?? [], box),
        stops: stops(),
      };
    case "GRADIENT_RADIAL": {
      const [center, edge, other] = paint.gradientHandlePositions ?? [];
      if (!center || !edge) return undefined;
      const radius = (to: Vec | undefined) =>
        to ? round(Math.hypot(to.x - center.x, to.y - center.y)) : 0.5;
      return {
        type: "radial",
        center: [round(center.x), round(center.y)],
        radius: [radius(edge), radius(other)],
        stops: stops(),
      };
    }
    case "IMAGE": {
      const src = paint.imageRef ? ctx.images.get(paint.imageRef) : undefined;
      if (src?.startsWith("data:image/")) {
        const fit =
          paint.scaleMode === "FIT"
            ? "contain"
            : paint.scaleMode === "STRETCH"
              ? "stretch"
              : "cover";
        return { type: "image", src, fit };
      }
      ctx.warnings.add("some image fills could not be embedded and were left out");
      return undefined;
    }
    default:
      ctx.warnings.add(`${paint.type.toLowerCase().replace(/_/g, " ")} fills are not supported`);
      return undefined;
  }
};

const strokeOf = (node: FigmaNode, ctx: Ctx): unknown => {
  const paint = visible(node.strokes).at(-1);
  if (!paint) return undefined;
  if (paint.type !== "SOLID" || !paint.color) {
    ctx.warnings.add("only solid strokes are supported");
    return undefined;
  }
  const sides = node.individualStrokeWeights;
  return {
    color: figmaColor(paint.color, paint.opacity),
    width: sides ? [sides.top, sides.right, sides.bottom, sides.left] : (node.strokeWeight ?? 1),
  };
};

const effectsOf = (node: FigmaNode, ctx: Ctx): unknown[] | undefined => {
  const out = visible(node.effects).flatMap((effect): unknown[] => {
    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      return [
        {
          type: "shadow",
          ...(effect.type === "INNER_SHADOW" ? { inner: true } : {}),
          color: figmaColor(effect.color ?? { r: 0, g: 0, b: 0, a: 0.25 }),
          x: round(effect.offset?.x ?? 0),
          y: round(effect.offset?.y ?? 0),
          blur: round(effect.radius ?? 0),
          ...(effect.spread ? { spread: round(effect.spread) } : {}),
        },
      ];
    }
    if (effect.type === "LAYER_BLUR") return [{ type: "blur", radius: round(effect.radius ?? 0) }];
    ctx.warnings.add(`${effect.type.toLowerCase().replace(/_/g, " ")} is not supported`);
    return [];
  });
  return out.length > 0 ? out : undefined;
};

const ALIGN: Record<string, string> = { MIN: "start", CENTER: "center", MAX: "end" };
const JUSTIFY: Record<string, string> = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  SPACE_BETWEEN: "space_between",
};

/** Rotation (counterclockwise degrees, like Pego) from a Figma relative transform. */
const rotationOf = (node: FigmaNode): number => {
  const row = node.relativeTransform?.[0];
  if (!row || row.length < 2) return 0;
  const degrees = round((Math.atan2(row[1]!, row[0]!) * 180) / Math.PI);
  return Math.abs(degrees) < 0.01 ? 0 : degrees;
};

/** Where a node's origin sits in its parent's space, from `relativeTransform`. */
const translationOf = (node: FigmaNode): Vec | null => {
  const [row0, row1] = node.relativeTransform ?? [];
  const x = row0?.[2];
  const y = row1?.[2];
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
};

/**
 * Where a node goes in its parent: its own size, its rotation, and the corner Pego rotates about
 * (the top-left), found from the box Figma reports around the rotated node.
 */
const placementOf = (node: FigmaNode, box: Box, parent: Box, local: Vec | null) => {
  const rotation = rotationOf(node);
  const width = node.size?.x ?? box.width;
  const height = node.size?.y ?? box.height;
  const shift = translationOf(node);
  // The relative transform's translation is the node's origin in its parent's own (possibly
  // rotated) space, exactly the corner Pego rotates about; the parent's bounding box is not.
  if (local && shift) {
    return { x: round(shift.x - local.x), y: round(shift.y - local.y), width, height, rotation };
  }
  if (rotation === 0) {
    return { x: round(box.x - parent.x), y: round(box.y - parent.y), width, height, rotation };
  }
  // Pego draws with canvas.rotate(-rotation) about (x, y): the rotated corners' minimum is the
  // offset from that corner to the box Figma reports.
  const angle = (-rotation * Math.PI) / 180;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([cx, cy]) => ({
    x: cx! * Math.cos(angle) - cy! * Math.sin(angle),
    y: cx! * Math.sin(angle) + cy! * Math.cos(angle),
  }));
  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  return {
    x: round(box.x - minX - parent.x),
    y: round(box.y - minY - parent.y),
    width,
    height,
    rotation,
  };
};

const sizeProp = (
  sizing: "FIXED" | "HUG" | "FILL" | undefined,
  value: number,
  inFlex: boolean,
): number | string => {
  if (sizing === "HUG") return "fit_content";
  if (sizing === "FILL" && inFlex) return "fill_container";
  return round(value);
};

const claim = (ctx: Ctx): boolean => {
  if (ctx.count >= ctx.max) {
    ctx.warnings.add(`only the first ${ctx.max} layers were imported`);
    return false;
  }
  ctx.count += 1;
  return true;
};

/**
 * `local` is the origin of the parent's coordinate space in the space `relativeTransform` is
 * given in: (0, 0) under a frame, the group's own position under a group (Figma groups have no
 * space of their own), null at the top level and under a group without a transform.
 */
const convert = (
  node: FigmaNode,
  parent: Box,
  parentFlex: boolean,
  ctx: Ctx,
  local: Vec | null = null,
): unknown => {
  const box = node.absoluteBoundingBox;
  if (!box || !claim(ctx)) return null;
  const place = placementOf(node, box, parent, local);
  const own = { width: place.width, height: place.height, x: box.x, y: box.y };
  const base: Record<string, unknown> = {
    id: createId(),
    name: node.name,
    x: place.x,
    y: place.y,
    ...(place.rotation ? { rotation: place.rotation } : {}),
    ...(node.visible === false ? { visible: false } : {}),
    ...(node.opacity !== undefined && node.opacity < 1 ? { opacity: round(node.opacity) } : {}),
  };
  // Absolute layers inside auto layout keep their place (Pego's layoutPosition) and fixed size.
  const absolute = parentFlex && node.layoutPositioning === "ABSOLUTE";
  if (absolute) base.layoutPosition = "absolute";
  const inFlow = parentFlex && !absolute;
  const width = sizeProp(node.layoutSizingHorizontal, place.width, inFlow);
  const height = sizeProp(node.layoutSizingVertical, place.height, inFlow);
  const radius =
    node.cornerRadius ?? (node.rectangleCornerRadii ? node.rectangleCornerRadii[0] : undefined);
  if (node.rectangleCornerRadii && new Set(node.rectangleCornerRadii).size > 1) {
    ctx.warnings.add("different radii per corner use the top-left one");
  }
  const fill = node.type === "TEXT" ? undefined : fillOf(node.fills, own, ctx);
  const stroke = node.type === "TEXT" ? undefined : strokeOf(node, ctx);
  if (visible(node.strokes).length > 0 && node.type !== "TEXT") {
    if (node.strokeAlign === "INSIDE" || node.strokeAlign === "OUTSIDE") {
      ctx.warnings.add("inside and outside strokes are drawn centered on the outline");
    }
  }
  const effects = effectsOf(node, ctx);
  const paint = {
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(effects ? { effects } : {}),
  };

  switch (node.type) {
    case "FRAME":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
    case "SECTION": {
      if (node.type === "INSTANCE") {
        ctx.warnings.add("component instances became plain frames (not linked to a component)");
      }
      const flex = node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
      if (flex && node.layoutWrap === "WRAP") {
        ctx.warnings.add("wrapping auto layout became a single row or column");
      }
      const children = (node.children ?? []).flatMap((child) => {
        const converted = convert(child, own, flex, ctx, { x: 0, y: 0 });
        return converted ? [converted] : [];
      });
      return {
        ...base,
        type: "frame",
        width,
        height,
        layout: flex ? (node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical") : "none",
        ...(flex
          ? {
              gap: round(node.itemSpacing ?? 0),
              padding: [
                node.paddingTop ?? 0,
                node.paddingRight ?? 0,
                node.paddingBottom ?? 0,
                node.paddingLeft ?? 0,
              ].map(round),
              justifyContent: JUSTIFY[node.primaryAxisAlignItems ?? "MIN"] ?? "start",
              alignItems: ALIGN[node.counterAxisAlignItems ?? "MIN"] ?? "start",
            }
          : {}),
        ...(node.clipsContent ? { clip: true } : {}),
        ...(radius ? { cornerRadius: round(radius) } : {}),
        ...(node.type === "COMPONENT" ? { reusable: true } : {}),
        ...paint,
        children,
      };
    }
    case "GROUP": {
      if (effects) ctx.warnings.add("effects on groups were dropped");
      const origin = translationOf(node);
      const children = (node.children ?? []).flatMap((child) => {
        const converted = convert(child, own, false, ctx, origin);
        return converted ? [converted] : [];
      });
      return { ...base, type: "group", children };
    }
    case "RECTANGLE":
      return {
        ...base,
        type: "rectangle",
        width,
        height,
        ...(radius ? { cornerRadius: round(radius) } : {}),
        ...paint,
      };
    case "ELLIPSE":
      return { ...base, type: "ellipse", width, height, ...paint };
    case "TEXT": {
      const style = node.style ?? {};
      if (node.characterStyleOverrides?.some((value) => value !== 0)) {
        ctx.warnings.add("text with mixed styles uses the style of its first character");
      }
      if (style.textAlignHorizontal === "JUSTIFIED") {
        ctx.warnings.add("justified text is left-aligned");
      }
      const solid = visible(node.fills).find((p) => p.type === "SOLID" && p.color);
      const autoWidth = node.textAutoResize === "WIDTH_AND_HEIGHT";
      const lineHeight =
        style.lineHeightPx && style.fontSize && style.lineHeightUnit !== "INTRINSIC_%"
          ? round(style.lineHeightPx / style.fontSize)
          : undefined;
      const align = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "left" }[
        style.textAlignHorizontal ?? "LEFT"
      ];
      return {
        ...base,
        type: "text",
        content: node.characters ?? "",
        ...(autoWidth ? {} : { width }),
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(style.fontSize ? { fontSize: round(style.fontSize) } : {}),
        ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
        ...(style.italic ? { fontStyle: "italic" } : {}),
        ...(lineHeight ? { lineHeight } : {}),
        ...(style.letterSpacing ? { letterSpacing: round(style.letterSpacing) } : {}),
        ...(align && align !== "left" ? { textAlign: align } : {}),
        ...(solid?.color ? { fill: figmaColor(solid.color, solid.opacity) } : {}),
        ...(effects ? { effects } : {}),
      };
    }
    case "VECTOR":
    case "STAR":
    case "POLYGON":
    case "LINE":
    case "BOOLEAN_OPERATION":
    case "REGULAR_POLYGON": {
      const filled = (node.fillGeometry ?? []).map((g) => g.path).join(" ");
      const outline = (node.strokeGeometry ?? []).map((g) => g.path).join(" ");
      const geometry = filled || outline;
      if (!geometry) {
        ctx.warnings.add("vectors without geometry were skipped (export with geometry=paths)");
        return null;
      }
      if (!filled && effects) ctx.warnings.add("effects on stroke-only vectors were dropped");
      // Only a stroke: its outline is the shape, painted with the stroke color.
      const strokeColor = (stroke as { color?: string } | undefined)?.color;
      return {
        ...base,
        type: "path",
        width: round(place.width) || 1,
        height: round(place.height) || 1,
        geometry,
        viewBox: [0, 0, round(place.width) || 1, round(place.height) || 1],
        ...(filled ? paint : { ...(strokeColor ? { fill: strokeColor } : {}) }),
      };
    }
    default:
      ctx.warnings.add(`${node.type.toLowerCase().replace(/_/g, " ")} layers are not supported`);
      return null;
  }
};

/**
 * Keep what the node schema accepts (Pego validates every node it stores). One invalid
 * descendant drops only itself, not the frame around it.
 */
const validNode = (node: unknown, warnings: Set<string>): PegoNode | null => {
  const fit = (value: unknown): PegoNode | null => {
    const parsed = nodeSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const record = node as { children?: unknown };
  const children = Array.isArray(record.children)
    ? record.children.flatMap((child) => {
        const valid = validNode(child, warnings);
        return valid ? [valid] : [];
      })
    : undefined;
  const result = fit(children ? { ...record, children } : node);
  if (!result) warnings.add("some layers did not fit Pego's format and were skipped");
  return result;
};

const validNodes = (raw: unknown[], warnings: Set<string>): PegoNode[] =>
  raw.flatMap((node) => {
    const valid = validNode(node, warnings);
    return valid ? [valid] : [];
  });

/**
 * Convert Figma nodes (a frame, or a page's top-level layers) into Pego nodes positioned from
 * (0, 0): the caller places them on the canvas. Image fills use `images` (imageRef -> data URI).
 */
export const convertFigmaNodes = (
  nodes: readonly FigmaNode[],
  images: ReadonlyMap<string, string> = new Map(),
  options: { maxNodes?: number } = {},
): FigmaConversion => {
  const ctx: Ctx = {
    images,
    warnings: new Set(),
    count: 0,
    max: options.maxNodes ?? MAX_FIGMA_NODES,
  };
  const boxes = nodes.flatMap((node) =>
    node.absoluteBoundingBox ? [node.absoluteBoundingBox] : [],
  );
  const origin = {
    x: Math.min(...boxes.map((box) => box.x)),
    y: Math.min(...boxes.map((box) => box.y)),
    width: 0,
    height: 0,
  };
  const raw = nodes.flatMap((node) => {
    const converted = convert(node, origin, false, ctx);
    return converted ? [converted] : [];
  });
  return { nodes: validNodes(raw, ctx.warnings), warnings: [...ctx.warnings], count: ctx.count };
};

/**
 * imageRefs of the image fills the converter uses (the top visible fill of each layer), to fetch
 * before converting.
 */
export const imageRefsOf = (nodes: readonly FigmaNode[], into = new Set<string>()): Set<string> => {
  for (const node of nodes) {
    const top = node.type === "TEXT" ? undefined : visible(node.fills).at(-1);
    if (top?.type === "IMAGE" && top.imageRef) into.add(top.imageRef);
    if (node.children) imageRefsOf(node.children, into);
  }
  return into;
};
