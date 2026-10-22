import {
  findNode,
  isContainer,
  MAX_INSTANCE_DEPTH,
  resolveColor,
  resolveInstance,
  resolveNumber,
  resolveString,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type TextNode,
} from "@pego/doc";
import { DEFAULT_FONT } from "./build";
import { googleFontsUrl } from "./fonts";
import { getIconProvider } from "./icons";
import type { FontUse } from "./ir";
import type { IconProvider } from "./types";

const round = (n: number): number => Math.round(n * 100) / 100;
const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Average glyph advance as a fraction of the font size, for estimating where text wraps. */
const AVG_GLYPH = 0.56;
const LINE_HEIGHT = 1.21;
const BASELINE = 0.97;

type Paint = { color: string; opacity?: number };

/** SVG 1.1 tools ignore `#rrggbbaa`, so split alpha into `*-opacity`. */
const toPaint = (hex: string): Paint => {
  const h = hex.toLowerCase();
  if (/^#[0-9a-f]{4}$/.test(h)) {
    const [, r, g, b, a] = h.split("") as [string, string, string, string, string];
    return { color: `#${r}${r}${g}${g}${b}${b}`, opacity: round(parseInt(a + a, 16) / 255) };
  }
  if (/^#[0-9a-f]{8}$/.test(h)) {
    return { color: h.slice(0, 7), opacity: round(parseInt(h.slice(7), 16) / 255) };
  }
  return { color: h };
};

const paintAttrs = (kind: "fill" | "stroke", hex: string | undefined): string => {
  if (!hex) return ` ${kind}="none"`;
  const { color, opacity } = toPaint(hex);
  return ` ${kind}="${color}"${opacity !== undefined ? ` ${kind}-opacity="${opacity}"` : ""}`;
};

type Ctx = {
  doc: PegoDocument;
  layout: Layout;
  icons: IconProvider | undefined;
  fonts: Map<string, FontUse>;
  defs: string[];
  clipCount: number;
};

const num = (ctx: Ctx, value: number | string | undefined, fallback: number): number =>
  resolveNumber(value, ctx.doc.variables, fallback);

const color = (ctx: Ctx, value: string | undefined): string | undefined =>
  resolveColor(value, ctx.doc.variables);

const strokeAttrs = (
  ctx: Ctx,
  stroke: { color: string; width?: number | string } | undefined,
): string => {
  const c = color(ctx, stroke?.color);
  if (!stroke || !c) return "";
  return `${paintAttrs("stroke", c)} stroke-width="${round(num(ctx, stroke.width, 1))}"`;
};

const addClip = (ctx: Ctx, w: number, h: number, radius: number): string => {
  const id = `clip${++ctx.clipCount}`;
  const r = Math.min(radius, w / 2, h / 2);
  ctx.defs.push(
    `<clipPath id="${id}"><rect width="${round(w)}" height="${round(h)}"${r > 0 ? ` rx="${round(r)}"` : ""} /></clipPath>`,
  );
  return id;
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
  const lineHeight = size * LINE_HEIGHT;
  const fill = paintAttrs("fill", color(ctx, node.fill) ?? "#000000");
  const generic = /mono|code|courier/i.test(family) ? "monospace" : "sans-serif";
  const attrs =
    ` font-family="'${esc(family)}', ${generic}" font-size="${round(size)}"` +
    (weight !== 400 ? ` font-weight="${weight}"` : "") +
    (italic ? ' font-style="italic"' : "") +
    `${fill} text-anchor="${anchor}" xml:space="preserve"`;
  const baseline = size * BASELINE;
  if (lines.length === 1) {
    return `<text x="${round(x)}" y="${round(baseline)}"${attrs}>${esc(lines[0] ?? "")}</text>`;
  }
  const spans = lines
    .map(
      (text, i) =>
        `<tspan x="${round(x)}" y="${round(baseline + i * lineHeight)}">${esc(text)}</tspan>`,
    )
    .join("");
  return `<text${attrs}>${spans}</text>`;
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
  const stroke = toPaint(color(ctx, node.fill) ?? "#ffffff");
  const shapes = elements
    .map(([tag, attrs]) => {
      const rendered = Object.entries(attrs)
        .filter(([key, value]) => key !== "key" && value !== undefined)
        .map(([key, value]) => ` ${key}="${esc(String(value))}"`)
        .join("");
      return `<${tag}${rendered} />`;
    })
    .join("");
  return `<svg width="${round(box.width)}" height="${round(box.height)}" viewBox="0 0 24 24" fill="none" stroke="${stroke.color}"${stroke.opacity !== undefined ? ` stroke-opacity="${stroke.opacity}"` : ""} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
};

const rectAttrs = (box: Box, radius: number): string => {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  return `width="${round(box.width)}" height="${round(box.height)}"${r > 0 ? ` rx="${round(r)}"` : ""}`;
};

const contentOf = (ctx: Ctx, node: PegoNode, box: Box): string => {
  switch (node.type) {
    case "frame": {
      const fill = color(ctx, node.fill);
      const stroke = strokeAttrs(ctx, node.stroke);
      if (!fill && !stroke) return "";
      return `<rect ${rectAttrs(box, num(ctx, node.cornerRadius, 0))}${paintAttrs("fill", fill)}${stroke} />`;
    }
    case "rectangle":
      return `<rect ${rectAttrs(box, num(ctx, node.cornerRadius, 0))}${paintAttrs("fill", color(ctx, node.fill))}${strokeAttrs(ctx, node.stroke)} />`;
    case "ellipse":
      return `<ellipse cx="${round(box.width / 2)}" cy="${round(box.height / 2)}" rx="${round(box.width / 2)}" ry="${round(box.height / 2)}"${paintAttrs("fill", color(ctx, node.fill))}${strokeAttrs(ctx, node.stroke)} />`;
    case "path":
      return `<path d="${esc(node.geometry)}"${paintAttrs("fill", color(ctx, node.fill))}${strokeAttrs(ctx, node.stroke)}${node.strokeCap ? ` stroke-linecap="${node.strokeCap}"` : ""}${node.strokeJoin ? ` stroke-linejoin="${node.strokeJoin}"` : ""} />`;
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
  const body = `${own}${children}`;
  if (!body) return "";

  const opacity = Math.min(1, Math.max(0, num(ctx, node.opacity, 1)));
  const rotation = isRoot ? 0 : num(ctx, node.rotation, 0);
  const dx = isRoot ? 0 : box.x - parent.x;
  const dy = isRoot ? 0 : box.y - parent.y;
  const transform = [
    dx !== 0 || dy !== 0 ? `translate(${round(dx)} ${round(dy)})` : "",
    rotation !== 0 ? `rotate(${round(-rotation)})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!transform && opacity === 1) return body;
  return `<g${transform ? ` transform="${transform}"` : ""}${opacity < 1 ? ` opacity="${round(opacity)}"` : ""}>${body}</g>`;
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
