import {
  findNode,
  shaderFallbackColor,
  flipOf,
  isContainer,
  placedByLayout,
  MAX_INSTANCE_DEPTH,
  resolveInstance,
  resolveNumber,
  resolveString,
  type Box,
  type Effect,
  type Fill,
  type FrameNode,
  type GroupNode,
  type ImageNode,
  type PathNode,
  type PegoDocument,
  type PegoNode,
  type RefNode,
  type Stroke,
  type TextNode,
} from "@pego/doc";
import type { BuildCtx, Decl, IrComponent, IrEl, IrIcon, IrNode, Parent, Scope } from "./ir";
import { camelCase, cssVarName, pascalCase, uniqueName } from "./naming";
import { paintDef, type SvgDef } from "./svg-paint";
import { countUpAttr, motionDecls } from "./motion-css";
import { shaderAttrs, shaderFillDecls } from "./shader-export";

export const DEFAULT_FONT = "Inter";

// --- values --------------------------------------------------------------------

const round2 = (n: number): number => Math.round(n * 100) / 100;
export const px = (n: number): string => (n === 0 ? "0" : `${round2(n)}px`);

const isVarRef = (value: string): boolean => value.startsWith("$");

/** A length: px, or `var(--name)` for a number variable. */
const lenOf = (value: number | string | undefined, ctx: BuildCtx, fallback = 0): string => {
  if (typeof value === "string" && isVarRef(value)) {
    const variable = ctx.doc.variables[value.slice(1)];
    if (variable?.type === "number") {
      ctx.vars.add(value.slice(1));
      return `var(--${cssVarName(value.slice(1))})`;
    }
  }
  return px(resolveNumber(value, ctx.doc.variables, fallback));
};

const numOf = (value: number | string | undefined, ctx: BuildCtx, fallback: number): number =>
  resolveNumber(value, ctx.doc.variables, fallback);

/** A color: lowercase hex, or `var(--name)` for a color variable. */
const colorOf = (value: string | undefined, ctx: BuildCtx): string | undefined => {
  if (value === undefined) return undefined;
  if (isVarRef(value)) {
    const variable = ctx.doc.variables[value.slice(1)];
    if (variable?.type !== "color") return undefined;
    ctx.vars.add(value.slice(1));
    return `var(--${cssVarName(value.slice(1))})`;
  }
  return value.toLowerCase();
};

const isZero = (len: string): boolean => len === "0";

// --- font helpers -----------------------------------------------------------------

const nearestWeight = (w: number): number =>
  Math.min(900, Math.max(100, Math.round(w / 100) * 100));

const registerFont = (ctx: BuildCtx, family: string, weight: number, italic: boolean): void => {
  const use = ctx.fonts.get(family) ?? { normal: new Set<number>(), italic: new Set<number>() };
  use[italic ? "italic" : "normal"].add(nearestWeight(weight));
  ctx.fonts.set(family, use);
};

const SERIF_HINT =
  /\b(serif|playfair|merriweather|lora|garamond|georgia|times|baskerville|cormorant|crimson|spectral|fraunces|dm serif)\b/i;
const MONO_HINT = /\b(mono|code|courier|consolas|menlo)\b/i;

export const fontStack = (family: string): string => {
  const generic = MONO_HINT.test(family)
    ? "monospace"
    : SERIF_HINT.test(family) && !/\bsans\b/i.test(family)
      ? "serif"
      : "sans-serif";
  return `"${family}", ${generic}`;
};

// --- size and placement ------------------------------------------------------------

type Axis = "width" | "height";

/** Extent of the children of an absolute container when no computed layout is available. */
const extentOf = (node: PegoNode, doc: PegoDocument): { width: number; height: number } => {
  if (!isContainer(node)) {
    return {
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
    };
  }
  let width = 0;
  let height = 0;
  for (const child of node.children) {
    const inner = extentOf(child, doc);
    const w = typeof child.width === "number" ? child.width : inner.width;
    const h = typeof child.height === "number" ? child.height : inner.height;
    width = Math.max(width, resolveNumber(child.x, doc.variables, 0) + w);
    height = Math.max(height, resolveNumber(child.y, doc.variables, 0) + h);
  }
  return { width, height };
};

type Parts = { decls: Decl[]; placement: Decl[] };

const mainAxisOf = (parent: Parent): Axis | undefined =>
  parent.kind === "flex" ? (parent.axis === "row" ? "width" : "height") : undefined;

/** True when the node lays its children out absolutely (so it cannot hug them in CSS). */
const hugsAbsolute = (node: PegoNode): boolean =>
  node.type === "group" || (node.type === "frame" && node.layout === "none");

const sizeParts = (
  node: PegoNode,
  axis: Axis,
  parent: Parent,
  ctx: BuildCtx,
  box: Box | undefined,
): Parts => {
  const decls: Decl[] = [];
  const placement: Decl[] = [];
  const value = node[axis];
  const main = mainAxisOf(parent);

  if (typeof value === "number") {
    decls.push([axis, px(value)]);
    if (main === axis) placement.push(["flex-shrink", "0"]);
    return { decls, placement };
  }
  if (value === "fill_container") {
    if (parent.kind === "flex") {
      if (main === axis) {
        placement.push(["flex", "1 1 0%"]);
        if (axis === "width") placement.push(["min-width", "0"]);
      } else placement.push(["align-self", "stretch"]);
    } else placement.push([axis, "100%"]);
    return { decls, placement };
  }
  // fit_content or unset
  if (node.type === "text") return { decls, placement };
  if (node.type === "frame" && node.layout !== "none") {
    if (parent.kind === "root" && axis === "width") decls.push(["width", "fit-content"]);
    return { decls, placement };
  }
  const hug = box?.[axis] ?? (hugsAbsolute(node) ? extentOf(node, ctx.doc)[axis] : 0);
  if (hug > 0) {
    decls.push([axis, px(hug)]);
    if (main === axis) placement.push(["flex-shrink", "0"]);
  }
  return { decls, placement };
};

const positionParts = (node: PegoNode, parent: Parent, ctx: BuildCtx): Decl[] =>
  parent.kind === "abs"
    ? [
        ["position", "absolute"],
        ["left", px(numOf(node.x, ctx, 0))],
        ["top", px(numOf(node.y, ctx, 0))],
      ]
    : [];

/**
 * CSS for the mirror around the box center. Alone it is `scaleX(-1)` / `scaleY(-1)` (the default
 * origin is the center). With a rotation the origin is the top-left corner, so the mirror also
 * moves the box back: `rotate() translate(w, 0) scale(-1, 1)`, the canvas order (rotate, then flip).
 */
const transformValue = (
  node: PegoNode,
  ctx: BuildCtx,
  box: Box | undefined,
  rotation: number,
): string | undefined => {
  const { x: flipX, y: flipY } = flipOf(node);
  if (!flipX && !flipY) return rotation !== 0 ? `rotate(${round2(-rotation)}deg)` : undefined;
  if (rotation === 0) {
    return flipX && flipY ? "scale(-1, -1)" : flipX ? "scaleX(-1)" : "scaleY(-1)";
  }
  const width =
    box?.width ?? numOf(typeof node.width === "number" ? node.width : undefined, ctx, 0);
  const height =
    box?.height ?? numOf(typeof node.height === "number" ? node.height : undefined, ctx, 0);
  const move = `translate(${px(flipX ? round2(width) : 0)}, ${px(flipY ? round2(height) : 0)})`;
  return `rotate(${round2(-rotation)}deg) ${move} scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
};

const transformParts = (node: PegoNode, ctx: BuildCtx, box: Box | undefined): Decl[] => {
  const decls: Decl[] = [];
  const opacity = Math.min(1, Math.max(0, numOf(node.opacity, ctx, 1)));
  if (opacity < 1) decls.push(["opacity", String(round2(opacity))]);
  const rotation = numOf(node.rotation, ctx, 0);
  const transform = transformValue(node, ctx, box, rotation);
  if (rotation !== 0) {
    // The canvas rotates counter-clockwise around the top-left corner.
    decls.push(["transform-origin", "top left"]);
  }
  if (transform) decls.push(["transform", transform]);
  if (node.type !== "page" && node.animation) {
    decls.push(...motionDecls(node.animation, rotation !== 0));
    ctx.motion.add(node.animation.preset);
  }
  return decls;
};

const combine = (...parts: Parts[]): Parts => ({
  decls: parts.flatMap((p) => p.decls),
  placement: parts.flatMap((p) => p.placement),
});

const boxParts = (node: PegoNode, parent: Parent, ctx: BuildCtx, box: Box | undefined): Parts => {
  const size = combine(
    sizeParts(node, "width", parent, ctx, box),
    sizeParts(node, "height", parent, ctx, box),
  );
  return {
    decls: [...size.decls, ...transformParts(node, ctx, box)],
    placement: [...positionParts(node, parent, ctx), ...size.placement],
  };
};

// --- appearance ----------------------------------------------------------------------

const SIDE_PROPS = ["border-top", "border-right", "border-bottom", "border-left"] as const;

const strokeDecl = (stroke: Stroke | undefined, ctx: BuildCtx): Decl[] => {
  if (!stroke) return [];
  const color = colorOf(stroke.color, ctx);
  if (!color) return [];
  if (!Array.isArray(stroke.width)) {
    const width = lenOf(stroke.width, ctx, 1);
    return isZero(width) ? [] : [["border", `${width} solid ${color}`]];
  }
  // Per-side widths: one border-<side> per visible side (0 hides it).
  const widths = stroke.width;
  return SIDE_PROPS.flatMap((prop, i): Decl[] => {
    const width = lenOf(widths[i], ctx, 0);
    return isZero(width) ? [] : [[prop, `${width} solid ${color}`]];
  });
};

const radiusDecl = (value: number | string | undefined, ctx: BuildCtx): Decl[] => {
  if (value === undefined) return [];
  const len = lenOf(value, ctx, 0);
  return isZero(len) ? [] : [["border-radius", len]];
};

const percent = (fraction: number): string => `${round2(fraction * 100)}%`;

const gradientCss = (
  fill: Exclude<Fill, string> & { type: "linear" | "radial" },
  ctx: BuildCtx,
) => {
  const stops = fill.stops
    .map((s) => `${colorOf(s.color, ctx) ?? "transparent"} ${percent(s.position)}`)
    .join(", ");
  if (fill.type === "linear") {
    return `linear-gradient(${round2(numOf(fill.angle, ctx, 180))}deg, ${stops})`;
  }
  const [cx, cy] = fill.center;
  const [rx, ry] = fill.radius;
  return `radial-gradient(${percent(rx)} ${percent(ry)} at ${percent(cx)} ${percent(cy)}, ${stops})`;
};

const fillDecl = (fill: Fill | undefined, ctx: BuildCtx): Decl[] => {
  if (fill === undefined) return [];
  if (typeof fill === "string") {
    const color = colorOf(fill, ctx);
    return color ? [["background-color", color]] : [];
  }
  if (fill.type === "shader") return shaderFillDecls(fill, ctx);
  if (fill.type === "image") {
    return [
      ["background-image", `url("${fill.src}")`],
      ["background-position", "center"],
      ["background-repeat", "no-repeat"],
      ["background-size", fill.fit === "stretch" ? "100% 100%" : fill.fit],
    ];
  }
  return [["background-image", gradientCss(fill, ctx)]];
};

/** One shadow as CSS (`inset` prefix for inner shadows); lengths are resolved to px. */
const shadowCss = (
  effect: Extract<Effect, { type: "shadow" }>,
  ctx: BuildCtx,
  withSpread: boolean,
): string | undefined => {
  const color = colorOf(effect.color, ctx);
  if (!color) return undefined;
  const spread = numOf(effect.spread, ctx, 0);
  const parts = [
    effect.inner ? "inset" : "",
    px(numOf(effect.x, ctx, 0)),
    px(numOf(effect.y, ctx, 0)),
    px(numOf(effect.blur, ctx, 0)),
    withSpread && spread !== 0 ? px(spread) : "",
    color,
  ];
  return parts.filter(Boolean).join(" ");
};

/**
 * Shadows and blur as CSS. `box`: box-shadow (inner shadows become inset) + filter blur.
 * `text`: text-shadow + blur. `filter`: drop-shadow() + blur for icons and paths; they have no
 * spread or inset form, so inner shadows are skipped there and in `text`.
 */
const effectDecls = (
  effects: Effect[] | undefined,
  ctx: BuildCtx,
  kind: "box" | "text" | "filter",
): Decl[] => {
  if (!effects?.length) return [];
  const shadows = effects.flatMap((effect) => {
    if (effect.type !== "shadow") return [];
    if (kind !== "box" && effect.inner) return [];
    const css = shadowCss(effect, ctx, kind === "box");
    return css ? [css] : [];
  });
  const blurs = effects.flatMap((effect) => {
    if (effect.type !== "blur") return [];
    const radius = numOf(effect.radius, ctx, 0);
    return radius > 0 ? [`blur(${px(radius)})`] : [];
  });
  const decls: Decl[] = [];
  if (shadows.length > 0) {
    if (kind === "box") decls.push(["box-shadow", shadows.join(", ")]);
    else if (kind === "text") decls.push(["text-shadow", shadows.join(", ")]);
  }
  const filters = [...(kind === "filter" ? shadows.map((s) => `drop-shadow(${s})`) : []), ...blurs];
  if (filters.length > 0) decls.push(["filter", filters.join(" ")]);
  return decls;
};

const paddingValue = (node: FrameNode, ctx: BuildCtx): string | undefined => {
  const { padding } = node;
  if (padding === undefined) return undefined;
  const sides = Array.isArray(padding)
    ? padding.map((p) => lenOf(p, ctx))
    : [lenOf(padding, ctx), lenOf(padding, ctx), lenOf(padding, ctx), lenOf(padding, ctx)];
  const [t, r, b, l] = sides as [string, string, string, string];
  if (sides.every(isZero)) return undefined;
  if (t === r && r === b && b === l) return t;
  if (t === b && l === r) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
};

const JUSTIFY: Record<string, string> = {
  center: "center",
  end: "flex-end",
  space_between: "space-between",
  space_around: "space-around",
};
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end" };

const frameLayoutDecls = (node: FrameNode, ctx: BuildCtx): Decl[] => {
  if (node.layout === "none") return node.children.length > 0 ? [["position", "relative"]] : [];
  const decls: Decl[] = [["display", "flex"]];
  // Absolute children (layoutPosition) are placed from this box.
  if (node.children.some((child) => !placedByLayout(node, flowNode(child, ctx)))) {
    decls.push(["position", "relative"]);
  }
  if (node.layout === "vertical") decls.push(["flex-direction", "column"]);
  const justify = JUSTIFY[node.justifyContent ?? "start"];
  if (justify) decls.push(["justify-content", justify]);
  decls.push(["align-items", ALIGN[node.alignItems ?? "start"] ?? "flex-start"]);
  const gap = lenOf(node.gap, ctx, 0);
  if (!isZero(gap)) decls.push(["gap", gap]);
  const padding = paddingValue(node, ctx);
  if (padding) decls.push(["padding", padding]);
  return decls;
};

// --- text ---------------------------------------------------------------------------------

const STRUCTURAL = /^(header|nav|footer|main|section|aside|article)\b/i;
const HEADING_NAME = /^(title|heading|headline|h[1-3])\b/i;

const textTag = (
  node: TextNode,
  ctx: BuildCtx,
  size: number,
  weight: number,
  content: string,
  wraps: boolean,
): string => {
  const level = (() => {
    if (HEADING_NAME.test(node.name ?? "")) return size >= 24 ? 1 : size >= 18 ? 2 : 3;
    if (size >= 32) return 1;
    if (size >= 24) return 2;
    if (size >= 20 && weight >= 600) return 3;
    return 0;
  })();
  if (level > 0) {
    const actual = level === 1 && ctx.h1Used ? 2 : level;
    if (actual === 1) ctx.h1Used = true;
    return `h${actual}`;
  }
  return wraps || content.length > 60 || content.includes("\n") ? "p" : "span";
};

const buildText = (
  node: TextNode,
  parent: Parent,
  ctx: BuildCtx,
  scope: Scope | undefined,
  box: Box | undefined,
): IrEl => {
  const { variables } = ctx.doc;
  const content = resolveString(node.content, variables);
  const family = node.fontFamily ?? DEFAULT_FONT;
  const size = numOf(node.fontSize, ctx, 14);
  const weight = nearestWeight(numOf(node.fontWeight, ctx, 400));
  const italic = node.fontStyle === "italic";
  registerFont(ctx, family, weight, italic);

  const parts = boxParts(node, parent, ctx, box);
  const wraps = node.width !== undefined;
  const fontSize = typeof node.fontSize === "string" ? lenOf(node.fontSize, ctx, 14) : px(size);
  const align = node.textAlign ?? "left";
  const hasNewline = content.includes("\n");
  const whiteSpace = hasNewline ? (wraps ? "pre-wrap" : "pre") : wraps ? undefined : "nowrap";
  const color = colorOf(node.fill, ctx) ?? "#000000";
  const lineHeight = numOf(node.lineHeight, ctx, 0);
  const letterSpacing = numOf(node.letterSpacing, ctx, 0);

  const decls: Decl[] = [
    ...parts.decls,
    ["font-family", fontStack(family)],
    ["font-size", fontSize],
    ...(weight !== 400 ? ([["font-weight", String(weight)]] as Decl[]) : []),
    ...(italic ? ([["font-style", "italic"]] as Decl[]) : []),
    ["line-height", node.lineHeight === undefined ? "normal" : String(round2(lineHeight))],
    ...(letterSpacing !== 0 ? ([["letter-spacing", px(letterSpacing)]] as Decl[]) : []),
    ...(align !== "left" ? ([["text-align", align]] as Decl[]) : []),
    ["color", color],
    ...(whiteSpace ? ([["white-space", whiteSpace]] as Decl[]) : []),
    ...effectDecls(node.effects, ctx, "text"),
  ];
  const propName = scope?.propOf.get(node.id);
  const counts = node.animation?.countUp === true && /\d/.test(content);
  if (counts) ctx.countUp = true;
  return {
    kind: "el",
    tag: textTag(node, ctx, size, weight, content, wraps),
    label: node.name ?? "text",
    decls,
    placement: parts.placement,
    attrs: counts && node.animation ? [countUpAttr(node.animation)] : [],
    children: [propName ? { kind: "prop", name: propName } : { kind: "text", value: content }],
  };
};

// --- leaves ----------------------------------------------------------------------------------

const buildImage = (node: ImageNode, parent: Parent, ctx: BuildCtx, box: Box | undefined): IrEl => {
  const parts = boxParts(node, parent, ctx, box);
  const fit = node.fit ?? "fill";
  const decls: Decl[] = [
    ...parts.decls,
    ...radiusDecl(node.cornerRadius, ctx),
    ...strokeDecl(node.stroke, ctx),
  ];
  const alt = node.alt ?? node.name ?? "";
  if (fit === "tile") {
    decls.push(["background-image", `url("${node.src}")`], ["background-repeat", "repeat"]);
    return {
      kind: "el",
      tag: "div",
      label: node.name ?? "image",
      decls,
      placement: parts.placement,
      attrs: [
        ["role", "img"],
        ["aria-label", alt],
      ],
      children: [],
    };
  }
  decls.push(["object-fit", fit === "fit" ? "contain" : fit === "crop" ? "none" : "cover"]);
  return {
    kind: "el",
    tag: "img",
    label: node.name ?? "image",
    decls,
    placement: parts.placement,
    attrs: [
      ["src", node.src],
      ["alt", alt],
    ],
    children: [],
  };
};

/** Rough extent of path data from its coordinates, for paths without a size or layout box. */
const geometryExtent = (geometry: string): { width: number; height: number } => {
  const numbers = (geometry.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  let width = 0;
  let height = 0;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    width = Math.max(width, numbers[i]!);
    height = Math.max(height, numbers[i + 1]!);
  }
  return { width: Math.ceil(width) || 24, height: Math.ceil(height) || 24 };
};

const toIr = (def: SvgDef): IrEl => ({
  kind: "el",
  tag: def.tag,
  label: def.tag,
  decls: [],
  placement: [],
  attrs: def.attrs,
  children: def.children.map(toIr),
});

const buildPath = (node: PathNode, parent: Parent, ctx: BuildCtx, box: Box | undefined): IrEl => {
  const extent = geometryExtent(node.geometry);
  // A path without its own size has a 0x0 layout box: fall back to its geometry.
  const width = typeof node.width === "number" ? node.width : box?.width || extent.width;
  const height = typeof node.height === "number" ? node.height : box?.height || extent.height;
  const parts = boxParts(node, parent, ctx, box);
  // With a viewBox the geometry is scaled to the node size; paints live in viewBox coordinates.
  const [minX, minY, vbWidth, vbHeight] = node.viewBox ?? [0, 0, width, height];
  const scaled = node.viewBox !== undefined;

  const defs: IrEl[] = [];
  const fill = node.fill;
  const fillAttr = ((): string => {
    if (fill === undefined) return "none";
    if (typeof fill === "string") return colorOf(fill, ctx) ?? "none";
    // SVG cannot run a shader: its first color stands in.
    if (fill.type === "shader") return shaderFallbackColor(fill, ctx.doc.variables).toLowerCase();
    const id = `paint${++ctx.paintCount}`;
    const angle = fill.type === "linear" ? numOf(fill.angle, ctx, 180) : 0;
    const area = { x: minX, y: minY, width: vbWidth, height: vbHeight };
    defs.push(toIr(paintDef(fill, id, area, angle, (c) => colorOf(c, ctx))));
    return `url(#${id})`;
  })();

  const strokeColor = node.stroke ? colorOf(node.stroke.color, ctx) : undefined;
  const pathAttrs: [string, string][] = [["d", node.geometry]];
  pathAttrs.push(["fill", fillAttr]);
  // Per-side widths have no meaning on a path outline: such a stroke is left out.
  if (strokeColor && node.stroke && !Array.isArray(node.stroke.width)) {
    pathAttrs.push(
      ["stroke", strokeColor],
      ["stroke-width", lenOf(node.stroke.width, ctx, 1).replace("px", "")],
    );
    if (node.strokeCap) pathAttrs.push(["stroke-linecap", node.strokeCap]);
    if (node.strokeJoin) pathAttrs.push(["stroke-linejoin", node.strokeJoin]);
    // Keep the stroke width in node units when the geometry is scaled.
    if (scaled) pathAttrs.push(["vector-effect", "non-scaling-stroke"]);
  }
  return {
    kind: "el",
    tag: "svg",
    label: node.name ?? "path",
    // The svg has explicit width/height attributes; keep only transforms from the box parts.
    decls: [
      ...parts.decls.filter(([p]) => p !== "width" && p !== "height"),
      ["overflow", "visible"],
      ...effectDecls(node.effects, ctx, "filter"),
    ],
    placement: parts.placement,
    attrs: [
      ["width", String(round2(width))],
      ["height", String(round2(height))],
      ["viewBox", `${round2(minX)} ${round2(minY)} ${round2(vbWidth)} ${round2(vbHeight)}`],
      ...(scaled ? ([["preserveAspectRatio", "none"]] as [string, string][]) : []),
      ["aria-hidden", "true"],
    ],
    children: [
      ...(defs.length > 0
        ? [
            {
              kind: "el" as const,
              tag: "defs",
              label: "defs",
              decls: [],
              placement: [],
              attrs: [],
              children: defs,
            },
          ]
        : []),
      {
        kind: "el",
        tag: "path",
        label: "path",
        decls: [],
        placement: [],
        attrs: pathAttrs,
        children: [],
      },
    ],
  };
};

const buildIcon = (
  node: Extract<PegoNode, { type: "icon" }>,
  parent: Parent,
  ctx: BuildCtx,
  box: Box | undefined,
): IrIcon => {
  const width = typeof node.width === "number" ? node.width : (box?.width ?? 24);
  const height = typeof node.height === "number" ? node.height : (box?.height ?? 24);
  const parts = boxParts(node, parent, ctx, box);
  const color = colorOf(node.fill, ctx) ?? "#ffffff";
  return {
    kind: "icon",
    icon: node.iconName,
    label: node.name ?? node.iconName,
    decls: [
      ...parts.decls.filter(([p]) => p !== "width" && p !== "height"),
      ["color", color],
      ...effectDecls(node.effects, ctx, "filter"),
    ],
    placement: parts.placement,
    width,
    height,
  };
};

// --- containers ----------------------------------------------------------------------------------

const childParent = (node: FrameNode | GroupNode): Parent =>
  node.type === "frame" && node.layout !== "none"
    ? { kind: "flex", axis: node.layout === "horizontal" ? "row" : "column" }
    : { kind: "abs" };

/** The node as the layout sees it: an instance takes `layoutPosition` from its component too. */
const flowNode = (child: PegoNode, ctx: BuildCtx): PegoNode =>
  child.type === "ref" ? (resolveInstance(ctx.doc, child) ?? child) : child;

const buildChildren = (
  node: FrameNode | GroupNode,
  ctx: BuildCtx,
  scope: Scope | undefined,
  depth: number,
): IrNode[] => {
  const parent = childParent(node);
  return node.children.flatMap((child) => {
    // An absolute child of a flex frame is positioned like a child of a `layout: "none"` frame.
    const own =
      parent.kind === "flex" && !placedByLayout(node, flowNode(child, ctx))
        ? ({ kind: "abs" } as const)
        : parent;
    return buildNode(child, own, ctx, scope, depth + 1) ?? [];
  });
};

const buildContainer = (
  node: FrameNode | GroupNode,
  parent: Parent,
  ctx: BuildCtx,
  scope: Scope | undefined,
  depth: number,
  box: Box | undefined,
): IrEl => {
  const parts = boxParts(node, parent, ctx, box);
  const own: Decl[] =
    node.type === "frame"
      ? [
          ...frameLayoutDecls(node, ctx),
          ...(node.clip ? ([["overflow", "hidden"]] as Decl[]) : []),
          ...fillDecl(node.fill, ctx),
          ...strokeDecl(node.stroke, ctx),
          ...radiusDecl(node.cornerRadius, ctx),
          ...effectDecls(node.effects, ctx, "box"),
        ]
      : [["position", "relative"]];
  const label = node.name ?? node.type;
  return {
    kind: "el",
    tag:
      STRUCTURAL.test(label) && node.type === "frame"
        ? label.match(STRUCTURAL)![1]!.toLowerCase()
        : "div",
    label,
    decls: [...parts.decls, ...own],
    placement: parts.placement,
    attrs: node.type === "frame" ? shaderAttrs(node.fill, ctx) : [],
    children: buildChildren(node, ctx, scope, depth),
  };
};

// --- components ------------------------------------------------------------------------------------

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const REF_FREE_KEYS = new Set(["id", "type", "ref", "descendants", "x", "y", "name", "reusable"]);

const findInTree = (root: PegoNode, id: string): PegoNode | undefined => {
  if (root.id === id) return root;
  if (!isContainer(root)) return undefined;
  for (const child of root.children) {
    const found = findInTree(child, id);
    if (found) return found;
  }
  return undefined;
};

/**
 * An instance maps onto a component usage when it only moves the instance and overrides the
 * text of text descendants. Anything else (fill, size, visibility...) is expanded in place.
 */
export const isSimpleInstance = (doc: PegoDocument, ref: RefNode): boolean => {
  const source = findNode(doc, ref.ref);
  if (!source?.reusable || source.type === "ref") return false;
  const sourceProps = source as Record<string, unknown>;
  for (const [key, value] of Object.entries(ref)) {
    if (REF_FREE_KEYS.has(key)) continue;
    if (!sameJson(value, sourceProps[key])) return false;
  }
  return Object.entries(ref.descendants ?? {}).every(([id, override]) => {
    const target = findInTree(source, id);
    return (
      target?.type === "text" &&
      Object.keys(override).every((key) => key === "content") &&
      typeof override.content === "string"
    );
  });
};

/** Which text descendants of each component some simple instance overrides: they become props. */
export const collectPropNames = (
  doc: PegoDocument,
  root: PegoNode,
): Map<string, Map<string, string>> => {
  const overridden = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const visit = (node: PegoNode): void => {
    if (node.type === "ref") {
      const source = findNode(doc, node.ref);
      if (!source) return;
      if (isSimpleInstance(doc, node)) {
        const ids = overridden.get(source.id) ?? new Set<string>();
        Object.keys(node.descendants ?? {}).forEach((id) => ids.add(id));
        overridden.set(source.id, ids);
      }
      if (!seen.has(source.id)) {
        seen.add(source.id);
        visit(source);
      }
      return;
    }
    if (isContainer(node)) node.children.forEach(visit);
  };
  visit(root);

  const result = new Map<string, Map<string, string>>();
  for (const [sourceId, ids] of overridden) {
    const source = findNode(doc, sourceId);
    if (!source) continue;
    const taken = new Set<string>(["className"]);
    const names = new Map<string, string>();
    const walk = (node: PegoNode): void => {
      if (node.type === "text" && ids.has(node.id)) {
        names.set(node.id, uniqueName(camelCase(node.name ?? "", "text"), taken));
      }
      if (isContainer(node)) node.children.forEach(walk);
    };
    walk(source);
    result.set(sourceId, names);
  }
  return result;
};

const useComponent = (source: PegoNode, ctx: BuildCtx): IrComponent => {
  const existing = ctx.components.get(source.id);
  if (existing) return existing;
  const name = uniqueName(pascalCase(source.name ?? "", "Component"), ctx.names);
  const propOf = ctx.propNames.get(source.id) ?? new Map<string, string>();
  const component: IrComponent = {
    name,
    props: [],
    root: {
      kind: "el",
      tag: "div",
      label: name,
      decls: [],
      placement: [],
      attrs: [],
      children: [],
    },
  };
  // Registered before building so a self-referencing component terminates.
  ctx.components.set(source.id, component);
  const built = buildNode(
    { ...source, reusable: false } as PegoNode,
    { kind: "root" },
    ctx,
    { propOf },
    0,
  );
  if (built && (built.kind === "el" || built.kind === "icon")) component.root = built;
  const texts: { id: string; name: string; value: string }[] = [];
  const walk = (node: PegoNode): void => {
    const prop = propOf.get(node.id);
    if (node.type === "text" && prop) {
      texts.push({
        id: node.id,
        name: prop,
        value: resolveString(node.content, ctx.doc.variables),
      });
    }
    if (isContainer(node)) node.children.forEach(walk);
  };
  walk(source);
  component.props = texts.map((t) => ({ name: t.name, default: t.value }));
  return component;
};

const buildRef = (
  ref: RefNode,
  parent: Parent,
  ctx: BuildCtx,
  scope: Scope | undefined,
  depth: number,
): IrNode | null => {
  if (depth >= MAX_INSTANCE_DEPTH) return null;
  const resolved = resolveInstance(ctx.doc, ref);
  if (!resolved) return null;
  if (ctx.inlineRefs || !isSimpleInstance(ctx.doc, ref)) {
    return buildNode(resolved, parent, ctx, scope, depth + 1);
  }
  const source = findNode(ctx.doc, ref.ref)!;
  const component = useComponent(source, ctx);
  const propOf = ctx.propNames.get(source.id) ?? new Map<string, string>();
  const props = Object.entries(ref.descendants ?? {}).flatMap(([id, override]) => {
    const prop = propOf.get(id);
    return prop && typeof override.content === "string"
      ? ([[prop, resolveString(override.content, ctx.doc.variables)]] as const)
      : [];
  });
  const box = ctx.layout?.get(ref.id);
  return {
    kind: "use",
    component: component.name,
    label: ref.name ?? source.name ?? "instance",
    decls: [...boxParts(resolved, parent, ctx, box).placement],
    props: [...props],
  };
};

// --- entry ----------------------------------------------------------------------------------------------

export const buildNode = (
  raw: PegoNode,
  parent: Parent,
  ctx: BuildCtx,
  scope: Scope | undefined,
  depth: number,
): IrNode | null => {
  // Hidden layers are not part of the design that ships.
  if (raw.visible === false) return null;
  if (raw.type === "ref") return buildRef(raw, parent, ctx, scope, depth);
  // Pages have no box or markup of their own; exportCode rejects them as roots.
  if (raw.type === "page") return null;
  // Connectors are wireflow notes between screens, not part of a screen's markup.
  if (raw.type === "connector") return null;
  const box = ctx.layout?.get(raw.id);
  switch (raw.type) {
    case "frame":
    case "group":
      return buildContainer(raw, parent, ctx, scope, depth, box);
    case "text":
      return buildText(raw, parent, ctx, scope, box);
    case "image":
      return buildImage(raw, parent, ctx, box);
    case "path":
      return buildPath(raw, parent, ctx, box);
    case "icon":
      return ctx.hasIcon && !ctx.hasIcon(raw.iconName) ? null : buildIcon(raw, parent, ctx, box);
    case "rectangle":
    case "ellipse": {
      const parts = boxParts(raw, parent, ctx, box);
      return {
        kind: "el",
        tag: "div",
        label: raw.name ?? raw.type,
        decls: [
          ...parts.decls,
          ...fillDecl(raw.fill, ctx),
          ...strokeDecl(raw.stroke, ctx),
          ...(raw.type === "ellipse"
            ? ([["border-radius", "50%"]] as Decl[])
            : radiusDecl(raw.cornerRadius, ctx)),
          ...effectDecls(raw.effects, ctx, "box"),
        ],
        placement: parts.placement,
        attrs: shaderAttrs(raw.fill, ctx),
        children: [],
      };
    }
  }
};

export const createBuildCtx = (
  doc: PegoDocument,
  layout: BuildCtx["layout"],
  inlineRefs: boolean,
  root: PegoNode,
  reservedName: string,
  hasIcon?: BuildCtx["hasIcon"],
): BuildCtx => ({
  doc,
  layout,
  inlineRefs,
  vars: new Set(),
  fonts: new Map(),
  components: new Map(),
  names: new Set([reservedName]),
  propNames: inlineRefs ? new Map() : collectPropNames(doc, root),
  h1Used: false,
  paintCount: 0,
  motion: new Set(),
  countUp: false,
  shaders: false,
  hasIcon,
});
