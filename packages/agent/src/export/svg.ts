import {
  shaderFallbackColor,
  findNode,
  flipOf,
  isContainer,
  MAX_INSTANCE_DEPTH,
  resolveColor,
  resolveInstance,
  resolveNumber,
  resolveSides,
  resolveString,
  type Box,
  type Effect,
  type Fill,
  type Stroke,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type TextNode,
} from "@pego/doc";
import { DEFAULT_FONT } from "./build";
import { googleFontsUrl } from "./fonts";
import { getIconProvider } from "./icons";
import type { FontUse } from "./ir";
import { paintDef, splitAlpha, type SvgDef } from "./svg-paint";
import { PAGE_EXPORT_ERROR, type IconProvider } from "./types";

const round = (n: number): number => Math.round(n * 100) / 100;
const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Average glyph advance as a fraction of the font size, for estimating where text wraps. */
const AVG_GLYPH = 0.56;
const LINE_HEIGHT = 1.21;
const BASELINE = 0.97;

const paintAttrs = (kind: "fill" | "stroke", hex: string | undefined): string => {
  if (!hex) return ` ${kind}="none"`;
  const { color, opacity } = splitAlpha(hex);
  return ` ${kind}="${color}"${opacity !== undefined ? ` ${kind}-opacity="${opacity}"` : ""}`;
};

const serializeDef = (def: SvgDef): string =>
  `<${def.tag}${def.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}>${def.children.map(serializeDef).join("")}</${def.tag}>`;

type Ctx = {
  doc: PegoDocument;
  layout: Layout;
  icons: IconProvider | undefined;
  fonts: Map<string, FontUse>;
  defs: string[];
  clipCount: number;
  /** Counter for unique paint and filter ids. */
  idCount: number;
};

const num = (ctx: Ctx, value: number | string | undefined, fallback: number): number =>
  resolveNumber(value, ctx.doc.variables, fallback);

const color = (ctx: Ctx, value: string | undefined): string | undefined =>
  resolveColor(value, ctx.doc.variables);

const strokeAttrs = (ctx: Ctx, stroke: Stroke | undefined): string => {
  const c = color(ctx, stroke?.color);
  // Per-side widths are drawn separately by sideStrokes.
  if (!stroke || !c || Array.isArray(stroke.width)) return "";
  return `${paintAttrs("stroke", c)} stroke-width="${round(num(ctx, stroke.width, 1))}"`;
};

const newId = (ctx: Ctx, prefix: string): string => `${prefix}${++ctx.idCount}`;

/** Fill attribute for a shape; gradients and images go into <defs> as paint servers. */
const fillAttrs = (ctx: Ctx, fill: Fill | undefined, w: number, h: number, minX = 0, minY = 0) => {
  if (fill === undefined) return paintAttrs("fill", undefined);
  if (typeof fill === "string") return paintAttrs("fill", color(ctx, fill));
  // SVG cannot run a shader: its first color stands in.
  if (fill.type === "shader")
    return paintAttrs("fill", shaderFallbackColor(fill, ctx.doc.variables));
  const id = newId(ctx, "paint");
  const angle = fill.type === "linear" ? num(ctx, fill.angle, 180) : 0;
  const area = { x: minX, y: minY, width: w, height: h };
  ctx.defs.push(serializeDef(paintDef(fill, id, area, angle, (c) => color(ctx, c))));
  return ` fill="url(#${id})"`;
};

const addClip = (ctx: Ctx, w: number, h: number, radius: number): string => {
  const id = `clip${++ctx.clipCount}`;
  const r = Math.min(radius, w / 2, h / 2);
  ctx.defs.push(
    `<clipPath id="${id}"><rect width="${round(w)}" height="${round(h)}"${r > 0 ? ` rx="${round(r)}"` : ""} /></clipPath>`,
  );
  return id;
};

/** Filter region large enough for blurred and offset results. */
const FILTER_REGION =
  'x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"';

/** A filter drawing the node's shadows (outer below, inner above); "" when it has none. */
const shadowFilter = (ctx: Ctx, effects: Effect[] | undefined): string => {
  const outer: string[] = [];
  const inner: string[] = [];
  const parts: string[] = [];
  (effects ?? []).forEach((effect, i) => {
    if (effect.type !== "shadow") return;
    const c = color(ctx, effect.color);
    if (!c) return;
    const { color: rgb, opacity = 1 } = splitAlpha(c);
    const dx = round(num(ctx, effect.x, 0));
    const dy = round(num(ctx, effect.y, 0));
    // CSS blur radius is twice the gaussian standard deviation.
    const sigma = round(num(ctx, effect.blur, 0) / 2);
    const spread = num(ctx, effect.spread, 0);
    const name = `s${i}`;
    if (effect.inner) {
      // Source alpha minus its shifted, blurred copy = the band just inside the edge.
      parts.push(
        `<feOffset in="SourceAlpha" dx="${dx}" dy="${dy}" result="${name}o"/>`,
        spread > 0
          ? `<feMorphology in="${name}o" operator="erode" radius="${round(spread)}" result="${name}o"/>`
          : "",
        `<feGaussianBlur in="${name}o" stdDeviation="${sigma}" result="${name}b"/>`,
        `<feComposite in="SourceAlpha" in2="${name}b" operator="arithmetic" k2="1" k3="-1" result="${name}m"/>`,
        `<feFlood flood-color="${rgb}" flood-opacity="${round(opacity)}"/>`,
        `<feComposite in2="${name}m" operator="in" result="${name}"/>`,
      );
      inner.push(name);
      return;
    }
    parts.push(
      spread > 0
        ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${round(spread)}" result="${name}d"/>`
        : "",
      `<feOffset in="${spread > 0 ? `${name}d` : "SourceAlpha"}" dx="${dx}" dy="${dy}" result="${name}o"/>`,
      `<feGaussianBlur in="${name}o" stdDeviation="${sigma}" result="${name}b"/>`,
      `<feFlood flood-color="${rgb}" flood-opacity="${round(opacity)}"/>`,
      `<feComposite in2="${name}b" operator="in" result="${name}"/>`,
    );
    outer.push(name);
  });
  if (outer.length === 0 && inner.length === 0) return "";
  const merged = [...outer, "SourceGraphic", ...inner]
    .map((name) => `<feMergeNode in="${name}"/>`)
    .join("");
  const id = newId(ctx, "fx");
  ctx.defs.push(
    `<filter id="${id}" ${FILTER_REGION}>${parts.filter(Boolean).join("")}<feMerge>${merged}</feMerge></filter>`,
  );
  return ` filter="url(#${id})"`;
};

/** A filter blurring the whole layer (the node and its children); "" without a blur effect. */
const blurFilter = (ctx: Ctx, effects: Effect[] | undefined): string => {
  const radius = (effects ?? []).reduce(
    (sum, effect) => (effect.type === "blur" ? sum + num(ctx, effect.radius, 0) : sum),
    0,
  );
  if (radius <= 0) return "";
  const id = newId(ctx, "fx");
  ctx.defs.push(
    `<filter id="${id}" ${FILTER_REGION}><feGaussianBlur stdDeviation="${round(radius)}"/></filter>`,
  );
  return ` filter="url(#${id})"`;
};

const effectsOf = (node: PegoNode): Effect[] | undefined =>
  "effects" in node ? node.effects : undefined;

type Shape = { tag: "rect" | "ellipse"; attrs: string };

/** Outline of a frame, rectangle, ellipse or image node in its own box. */
const shapeOf = (ctx: Ctx, node: PegoNode, box: Box): Shape => {
  if (node.type === "ellipse") {
    return {
      tag: "ellipse",
      attrs: `cx="${round(box.width / 2)}" cy="${round(box.height / 2)}" rx="${round(box.width / 2)}" ry="${round(box.height / 2)}"`,
    };
  }
  const radius =
    node.type === "frame" || node.type === "rectangle" || node.type === "image"
      ? num(ctx, node.cornerRadius, 0)
      : 0;
  return { tag: "rect", attrs: rectAttrs(box, radius) };
};

/**
 * Per-side strokes as filled bars along the box edges, clipped to the shape's outline so they
 * follow rounded corners. Uniform strokes are drawn on the shape itself.
 */
const sideStrokes = (ctx: Ctx, node: PegoNode, box: Box): string => {
  if (!("stroke" in node) || !node.stroke || !Array.isArray(node.stroke.width)) return "";
  const c = color(ctx, node.stroke.color);
  if (!c) return "";
  const [top, right, bottom, left] = resolveSides(node.stroke.width, ctx.doc.variables, 0);
  const { width, height } = box;
  const bars = [
    top > 0 ? [0, 0, width, top] : null,
    bottom > 0 ? [0, height - bottom, width, bottom] : null,
    left > 0 ? [0, 0, left, height] : null,
    right > 0 ? [width - right, 0, right, height] : null,
  ]
    .filter((bar): bar is number[] => bar !== null)
    .map(
      ([x, y, w, h]) =>
        `<rect x="${round(x!)}" y="${round(y!)}" width="${round(w!)}" height="${round(h!)}"${paintAttrs("fill", c)} />`,
    )
    .join("");
  if (!bars) return "";
  const shape = shapeOf(ctx, node, box);
  const id = newId(ctx, "clip");
  ctx.defs.push(`<clipPath id="${id}"><${shape.tag} ${shape.attrs} /></clipPath>`);
  return `<g clip-path="url(#${id})">${bars}</g>`;
};

const wrapLines = (content: string, maxWidth: number | undefined, size: number): string[] =>
  content.split("\n").flatMap((paragraph) => {
    if (maxWidth === undefined) return [paragraph];
    const limit = Math.max(1, Math.floor(maxWidth / (size * AVG_GLYPH)));
    const lines: string[] = [];
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > limit && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    lines.push(current);
    return lines;
  });

const textElement = (ctx: Ctx, node: TextNode, box: Box): string => {
  const content = resolveString(node.content, ctx.doc.variables);
  const family = node.fontFamily ?? DEFAULT_FONT;
  const size = num(ctx, node.fontSize, 14);
  const weight = Math.min(
    900,
    Math.max(100, Math.round(num(ctx, node.fontWeight, 400) / 100) * 100),
  );
  const italic = node.fontStyle === "italic";
  const use = ctx.fonts.get(family) ?? { normal: new Set<number>(), italic: new Set<number>() };
  use[italic ? "italic" : "normal"].add(weight);
  ctx.fonts.set(family, use);

  const align = node.textAlign ?? "left";
  const x = align === "center" ? box.width / 2 : align === "right" ? box.width : 0;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const wraps = node.width !== undefined;
  const lines = wrapLines(content, wraps ? box.width : undefined, size);
  // `lineHeight` is a multiple of the font size; without it the font's natural height is estimated.
  const lineHeight =
    size * (node.lineHeight === undefined ? LINE_HEIGHT : num(ctx, node.lineHeight, LINE_HEIGHT));
  const letterSpacing = num(ctx, node.letterSpacing, 0);
  const fill = paintAttrs("fill", color(ctx, node.fill) ?? "#000000");
  const generic = /mono|code|courier/i.test(family) ? "monospace" : "sans-serif";
  const attrs =
    ` font-family="'${esc(family)}', ${generic}" font-size="${round(size)}"` +
    (weight !== 400 ? ` font-weight="${weight}"` : "") +
    (italic ? ' font-style="italic"' : "") +
    (letterSpacing !== 0 ? ` letter-spacing="${round(letterSpacing)}"` : "") +
    `${fill} text-anchor="${anchor}" xml:space="preserve"`;
  // Keep the baseline centered in the line box when a custom line height is set.
  const baseline = size * BASELINE + (lineHeight - size * LINE_HEIGHT) / 2;
  const shadow = shadowFilter(ctx, node.effects);
  if (lines.length === 1) {
    return `<text x="${round(x)}" y="${round(baseline)}"${attrs}${shadow}>${esc(lines[0] ?? "")}</text>`;
  }
  const spans = lines
    .map(
      (text, i) =>
        `<tspan x="${round(x)}" y="${round(baseline + i * lineHeight)}">${esc(text)}</tspan>`,
    )
    .join("");
  return `<text${attrs}${shadow}>${spans}</text>`;
};

const imageElement = (ctx: Ctx, node: Extract<PegoNode, { type: "image" }>, box: Box): string => {
  const fit = node.fit ?? "fill";
  const radius = num(ctx, node.cornerRadius, 0);
  const aspect = fit === "fit" ? "xMidYMid meet" : "xMidYMid slice";
  const clip =
    fit !== "fit" || radius > 0 ? addClip(ctx, box.width, box.height, radius) : undefined;
  const image = `<image href="${esc(node.src)}" width="${round(box.width)}" height="${round(box.height)}" preserveAspectRatio="${aspect}"${clip ? ` clip-path="url(#${clip})"` : ""} />`;
  const stroke = strokeAttrs(ctx, node.stroke);
  if (!stroke) return image;
  const r = Math.min(radius, box.width / 2, box.height / 2);
  return `${image}<rect width="${round(box.width)}" height="${round(box.height)}"${r > 0 ? ` rx="${round(r)}"` : ""} fill="none"${stroke} />`;
};

const iconElement = (ctx: Ctx, node: Extract<PegoNode, { type: "icon" }>, box: Box): string => {
  const elements = ctx.icons?.(node.iconName);
  if (!elements) return `<!-- icon ${esc(node.iconName)}: no icon data available -->`;
  const stroke = splitAlpha(color(ctx, node.fill) ?? "#ffffff");
  const shapes = elements
    .map(([tag, attrs]) => {
      const rendered = Object.entries(attrs)
        .filter(([key, value]) => key !== "key" && value !== undefined)
        .map(([key, value]) => ` ${key}="${esc(String(value))}"`)
        .join("");
      return `<${tag}${rendered} />`;
    })
    .join("");
  const shadow = shadowFilter(ctx, node.effects);
  return `<svg width="${round(box.width)}" height="${round(box.height)}" viewBox="0 0 24 24"${shadow} fill="none" stroke="${stroke.color}"${stroke.opacity !== undefined ? ` stroke-opacity="${stroke.opacity}"` : ""} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
};

const rectAttrs = (box: Box, radius: number): string => {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  return `width="${round(box.width)}" height="${round(box.height)}"${r > 0 ? ` rx="${round(r)}"` : ""}`;
};

const pathElement = (ctx: Ctx, node: Extract<PegoNode, { type: "path" }>, box: Box): string => {
  const shared =
    `${strokeAttrs(ctx, node.stroke)}` +
    `${node.strokeCap ? ` stroke-linecap="${node.strokeCap}"` : ""}` +
    `${node.strokeJoin ? ` stroke-linejoin="${node.strokeJoin}"` : ""}`;
  const shadow = shadowFilter(ctx, node.effects);
  const { viewBox } = node;
  if (!viewBox || viewBox[2] <= 0 || viewBox[3] <= 0) {
    const fill = fillAttrs(ctx, node.fill, box.width, box.height);
    return `<path d="${esc(node.geometry)}"${fill}${shared}${shadow} />`;
  }
  // The geometry is scaled to the node's box by a nested svg; paints live in viewBox coordinates.
  const [minX, minY, vbWidth, vbHeight] = viewBox;
  const fill = fillAttrs(ctx, node.fill, vbWidth, vbHeight, minX, minY);
  const inner = `<svg width="${round(box.width)}" height="${round(box.height)}" viewBox="${viewBox.map(round).join(" ")}" preserveAspectRatio="none" overflow="visible"><path d="${esc(node.geometry)}"${fill}${shared} vector-effect="non-scaling-stroke" /></svg>`;
  return shadow ? `<g${shadow}>${inner}</g>` : inner;
};

const contentOf = (ctx: Ctx, node: PegoNode, box: Box): string => {
  switch (node.type) {
    case "frame": {
      const fill = node.fill === undefined ? "" : fillAttrs(ctx, node.fill, box.width, box.height);
      const stroke = strokeAttrs(ctx, node.stroke);
      if (!fill && !stroke) return "";
      const shadow = shadowFilter(ctx, node.effects);
      return `<rect ${rectAttrs(box, num(ctx, node.cornerRadius, 0))}${fill || paintAttrs("fill", undefined)}${stroke}${shadow} />`;
    }
    case "rectangle":
      return `<rect ${rectAttrs(box, num(ctx, node.cornerRadius, 0))}${fillAttrs(ctx, node.fill, box.width, box.height)}${strokeAttrs(ctx, node.stroke)}${shadowFilter(ctx, node.effects)} />`;
    case "ellipse":
      return `<ellipse ${shapeOf(ctx, node, box).attrs}${fillAttrs(ctx, node.fill, box.width, box.height)}${strokeAttrs(ctx, node.stroke)}${shadowFilter(ctx, node.effects)} />`;
    case "path":
      return pathElement(ctx, node, box);
    case "text":
      return textElement(ctx, node, box);
    case "icon":
      return iconElement(ctx, node, box);
    case "image":
      return imageElement(ctx, node, box);
    default:
      return "";
  }
};

const renderNode = (
  ctx: Ctx,
  raw: PegoNode,
  parent: Box,
  depth: number,
  isRoot: boolean,
): string => {
  const node =
    raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(ctx.doc, raw) : raw;
  if (!node) return "";
  const box = ctx.layout.get(node.id);
  if (!box) return "";

  const own = contentOf(ctx, node, box);
  let children = "";
  if (isContainer(node)) {
    const inner = node.children
      .map((child) => renderNode(ctx, child, box, depth + 1, false))
      .join("");
    children =
      node.type === "frame" && node.clip && inner
        ? `<g clip-path="url(#${addClip(ctx, box.width, box.height, num(ctx, node.cornerRadius, 0))})">${inner}</g>`
        : inner;
  }
  const body = `${own}${children}${sideStrokes(ctx, node, box)}`;
  if (!body) return "";

  const opacity = Math.min(1, Math.max(0, num(ctx, node.opacity, 1)));
  const rotation = isRoot ? 0 : num(ctx, node.rotation, 0);
  const dx = isRoot ? 0 : box.x - parent.x;
  const dy = isRoot ? 0 : box.y - parent.y;
  const transform = [
    dx !== 0 || dy !== 0 ? `translate(${round(dx)} ${round(dy)})` : "",
    rotation !== 0 ? `rotate(${round(-rotation)})` : "",
    flipTransform(node, box),
  ]
    .filter(Boolean)
    .join(" ");
  const blur = blurFilter(ctx, effectsOf(node));
  if (!transform && opacity === 1 && !blur) return body;
  return `<g${transform ? ` transform="${transform}"` : ""}${opacity < 1 ? ` opacity="${round(opacity)}"` : ""}${blur}>${body}</g>`;
};

/**
 * Mirror around the box center, applied after the rotation like the canvas does:
 * `translate(w 0) scale(-1 1)` for flipX (x -> w - x), the same for y.
 */
const flipTransform = (node: PegoNode, box: Box): string => {
  const { x: flipX, y: flipY } = flipOf(node);
  if (!flipX && !flipY) return "";
  const move = `translate(${flipX ? round(box.width) : 0} ${flipY ? round(box.height) : 0})`;
  return `${move} scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`;
};

/**
 * Serialize a node (and its subtree) to a standalone SVG string at 1 document unit = 1 user
 * unit. Needs the computed layout. Fonts are referenced by family (plus a Google Fonts import),
 * wrapped text is line-broken with an estimate, and path markers are not drawn.
 */
export const exportSvg = (
  doc: PegoDocument,
  nodeId: string,
  options: { layout: Layout; icons?: IconProvider },
): string => {
  const root = findNode(doc, nodeId);
  if (!root) throw new Error(`Unknown node: ${nodeId}`);
  if (root.type === "page") throw new Error(PAGE_EXPORT_ERROR);
  const rootNode = root.type === "ref" ? resolveInstance(doc, root) : root;
  const box = options.layout.get(root.id);
  if (!rootNode || !box) throw new Error(`Node ${nodeId} has no layout`);
  if (box.width <= 0 || box.height <= 0) throw new Error(`Node ${nodeId} has no visible size`);

  const ctx: Ctx = {
    doc,
    layout: options.layout,
    icons: options.icons ?? getIconProvider(),
    fonts: new Map(),
    defs: [],
    clipCount: 0,
    idCount: 0,
  };
  const body = renderNode(ctx, root, box, 0, true);
  const fontsUrl = googleFontsUrl(ctx.fonts);
  const defs = [
    ...(fontsUrl ? [`<style>@import url('${fontsUrl.replace(/&/g, "&amp;")}');</style>`] : []),
    ...ctx.defs,
  ];
  const w = round(box.width);
  const h = round(box.height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    ...(defs.length ? [`<defs>${defs.join("")}</defs>`] : []),
    body,
    "</svg>",
    "",
  ].join("\n");
};
