/**
 * DOM snapshot -> Pego nodes. Pure: the browser host walks the page into a `DomSnapshot`, this
 * turns it into one raw frame (no ids yet, ready for `assignIds` + `parseNode`). Children are
 * placed absolutely at their measured boxes: faithful positions beat flex reconstruction.
 * Odd input never throws; anything that cannot be represented becomes a warning.
 */
import { nodeSchema } from "@pego/doc";
import type { DomBox, DomSnapshot, DomSnapshotNode, DomStyle } from "../browser-types";
import { ImageSrcError, validateImageSrc } from "./image-src";
import { convertSvg, SvgError, type RawNode } from "./svg";

export const MAX_DOM_NODES = 2500;
const MAX_DEPTH = 100;
const MAX_WARNINGS = 50;
const NAME_TEXT_LENGTH = 30;

export type DomConversionOptions = {
  /** Name the root like the page (full page) instead of the element. Default: root tag is body/html. */
  fullPage?: boolean;
  /** Node cap (default MAX_DOM_NODES). */
  maxNodes?: number;
};

export type DomConversion = { node: RawNode; warnings: string[]; count: number };

type Ctx = {
  count: number;
  max: number;
  warnings: string[];
  seen: Set<string>;
  capped: boolean;
};

const warn = (ctx: Ctx, message: string): void => {
  if (ctx.seen.has(message)) return;
  ctx.seen.add(message);
  if (ctx.warnings.length < MAX_WARNINGS) ctx.warnings.push(message);
  else if (ctx.warnings.length === MAX_WARNINGS) ctx.warnings.push("more warnings omitted");
};

// --- numbers ---------------------------------------------------------------------

const round = (value: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// --- colors ----------------------------------------------------------------------

export type ParsedColor = { hex: string; alpha: number };

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
};

const toHex = (r: number, g: number, b: number, a: number): ParsedColor => {
  const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const h = (v: number) => byte(v).toString(16).padStart(2, "0");
  const a8 = byte(Math.min(1, Math.max(0, a)) * 255);
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return { hex: a8 === 255 ? base : `${base}${h(a8)}`, alpha: a8 / 255 };
};

const channel = (token: string, scale: number): number | null => {
  const value = token.endsWith("%") ? (parseFloat(token) / 100) * scale : parseFloat(token);
  return Number.isFinite(value) ? value : null;
};

/**
 * Parse a CSS color (hex, rgb/rgba, `color(srgb ...)`, transparent, a few names).
 * Returns null when it cannot be read. Fully transparent colors parse (alpha 0).
 */
export const parseColor = (input: string | undefined): ParsedColor | null => {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value === "transparent") return { hex: "#00000000", alpha: 0 };
  const named = NAMED[value];
  if (named) return { hex: named, alpha: 1 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = [...hex].map((c) => parseInt(c + c, 16)) as [
        number,
        number,
        number,
        number?,
      ];
      return toHex(r, g, b, a === undefined ? 1 : a / 255);
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      return toHex(n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1);
    }
    return null;
  }
  const fn = /^(rgba?|color)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const isColorFn = fn[1] === "color";
  const parts = (fn[2] ?? "").split(/[\s,/]+/).filter(Boolean);
  if (isColorFn) {
    if (parts.shift() !== "srgb") return null;
  }
  if (parts.length < 3 || parts.length > 4) return null;
  const scale = isColorFn ? 1 : 255;
  const rgb = parts.slice(0, 3).map((p) => channel(p, scale));
  if (rgb.some((v) => v === null)) return null;
  const [r, g, b] = (rgb as number[]).map((v) => (isColorFn ? v * 255 : v)) as [
    number,
    number,
    number,
  ];
  const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (alpha === null) return null;
  return toHex(r, g, b, alpha);
};

/** A paint color: null for unreadable or fully transparent colors. */
const paintColor = (input: string | undefined): string | null => {
  const parsed = parseColor(input);
  return parsed && parsed.alpha > 0 ? parsed.hex : null;
};

// --- css tokenizing --------------------------------------------------------------

/** Split on `separator` outside parentheses and quotes. */
const splitTop = (input: string, separator: "," | " "): string[] => {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && (separator === "," ? ch === "," : /\s/.test(ch))) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

// --- gradients -------------------------------------------------------------------

type Stop = { color: string; position: number };

const SIDE_ANGLES: Record<string, number> = {
  top: 0,
  "top right": 45,
  right: 90,
  "bottom right": 135,
  bottom: 180,
  "bottom left": 225,
  left: 270,
  "top left": 315,
};

const parseAngle = (token: string): number | null => {
  const m = /^(-?\d*\.?\d+)(deg|grad|rad|turn)?$/.exec(token);
  if (!m) return null;
  const n = parseFloat(m[1] ?? "");
  switch (m[2]) {
    case "grad":
      return (n * 360) / 400;
    case "rad":
      return (n * 180) / Math.PI;
    case "turn":
      return n * 360;
    default:
      return n;
  }
};

/** Parse one `linear-gradient(...)` layer into an angle and 2+ stops, or null. */
export const parseLinearGradient = (
  layer: string,
  length: number,
): { angle: number; stops: Stop[] } | null => {
  const m = /^(repeating-)?linear-gradient\((.*)\)$/is.exec(layer.trim());
  if (!m || m[1]) return null;
  const args = splitTop(m[2] ?? "", ",");
  let angle = 180;
  const first = args[0]?.toLowerCase() ?? "";
  if (first.startsWith("to ")) {
    const side = SIDE_ANGLES[first.slice(3).trim().replace(/\s+/g, " ")];
    if (side === undefined) return null;
    angle = side;
    args.shift();
  } else {
    const parsed = parseAngle(first);
    if (parsed !== null) {
      angle = parsed;
      args.shift();
    }
  }
  const raw: { color: string; positions: number[] }[] = [];
  for (const arg of args) {
    const tokens = splitTop(arg, " ");
    const color = paintColorOrTransparent(tokens[0]);
    if (!color) {
      // A color hint (a bare length) is ignored; anything else is unreadable.
      if (tokens.length === 1 && /^-?\d*\.?\d+(%|px)?$/.test(tokens[0] ?? "")) continue;
      return null;
    }
    const positions: number[] = [];
    for (const token of tokens.slice(1)) {
      const pos = /^(-?\d*\.?\d+)(%|px)$/.exec(token);
      if (!pos) return null;
      const n = parseFloat(pos[1] ?? "");
      positions.push(pos[2] === "%" ? n / 100 : length > 0 ? n / length : 0);
    }
    if (positions.length > 2) return null;
    raw.push({ color, positions });
  }
  const flat = raw.flatMap(({ color, positions }): { color: string; position: number | null }[] =>
    positions.length === 0
      ? [{ color, position: null }]
      : positions.map((position) => ({ color, position })),
  );
  if (flat.length < 2) return null;
  if (flat[0] && flat[0].position === null) flat[0].position = 0;
  const last = flat[flat.length - 1];
  if (last && last.position === null) last.position = 1;
  // Fill gaps evenly between known positions.
  let i = 0;
  while (i < flat.length) {
    if (flat[i]?.position !== null) {
      i++;
      continue;
    }
    const start = i - 1;
    let end = i;
    while (flat[end]?.position === null) end++;
    const a = flat[start]?.position ?? 0;
    const b = flat[end]?.position ?? 1;
    for (let k = start + 1; k < end; k++) {
      const item = flat[k];
      if (item) item.position = a + ((b - a) * (k - start)) / (end - start);
    }
    i = end;
  }
  let prev = 0;
  const stops = flat.map(({ color, position }) => {
    const clamped = Math.min(1, Math.max(prev, position ?? prev));
    prev = clamped;
    return { color, position: round(clamped, 4) };
  });
  return { angle: round(((angle % 360) + 360) % 360, 2), stops };
};

/** Like paintColor, but fully transparent stays (gradient stops fade to transparent). */
const paintColorOrTransparent = (input: string | undefined): string | null =>
  parseColor(input)?.hex ?? null;

// --- shadows ---------------------------------------------------------------------

type Shadow = {
  type: "shadow";
  color: string;
  x: number;
  y: number;
  blur: number;
  spread?: number;
  inner?: boolean;
};

const LENGTH = /^(-?\d*\.?\d+)(px)?$/;

/** Parse `box-shadow` (comma separated, inset supported). Unreadable shadows are dropped. */
export const parseBoxShadow = (
  input: string | undefined,
): { shadows: Shadow[]; dropped: number } => {
  const shadows: Shadow[] = [];
  let dropped = 0;
  if (!input || input.trim() === "none") return { shadows, dropped };
  for (const layer of splitTop(input, ",")) {
    let inner = false;
    let color: ParsedColor | null = null;
    const lengths: number[] = [];
    let bad = false;
    for (const token of splitTop(layer, " ")) {
      if (token.toLowerCase() === "inset") inner = true;
      else if (LENGTH.test(token)) lengths.push(parseFloat(token));
      else {
        const parsed = parseColor(token);
        if (parsed) color = parsed;
        else bad = true;
      }
    }
    if (bad || lengths.length < 2 || lengths.length > 4) {
      dropped++;
      continue;
    }
    if (!color) color = { hex: "#000000", alpha: 1 };
    if (color.alpha <= 0) continue;
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    shadows.push({
      type: "shadow",
      color: color.hex,
      x: round(x),
      y: round(y),
      blur: Math.max(0, round(blur)),
      ...(spread !== 0 ? { spread: round(spread) } : {}),
      ...(inner ? { inner: true } : {}),
    });
  }
  return { shadows, dropped };
};

// --- fonts -----------------------------------------------------------------------

const GENERIC_SANS = new Set([
  "sans-serif",
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "ui-sans-serif",
]);

/** First family of a font stack without quotes; generic sans stacks map to Inter. */
export const pickFontFamily = (stack: string | undefined): string | undefined => {
  if (!stack) return undefined;
  const first = splitTop(stack, ",")[0]
    ?.replace(/^["']|["']$/g, "")
    .trim();
  if (!first) return undefined;
  return GENERIC_SANS.has(first.toLowerCase()) ? "Inter" : first;
};

const applyTransform = (text: string, transform: string | undefined): string => {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(
        /(^|[\s\-(])(\p{L})/gu,
        (_, pre: string, ch: string) => pre + ch.toUpperCase(),
      );
    default:
      return text;
  }
};

const TEXT_ALIGN: Record<string, "left" | "center" | "right"> = {
  left: "left",
  start: "left",
  justify: "left",
  center: "center",
  "-webkit-center": "center",
  right: "right",
  end: "right",
};

// --- visuals ---------------------------------------------------------------------

type Props = Record<string, unknown>;

const validBox = (box: DomBox | undefined): box is DomBox =>
  !!box &&
  isNum(box.x) &&
  isNum(box.y) &&
  isNum(box.width) &&
  isNum(box.height) &&
  box.width > 0 &&
  box.height > 0;

const sameBox = (a: DomBox, b: DomBox): boolean =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

const strokeOf = (style: DomStyle): Props | null => {
  const widths = style.borderWidth;
  if (!widths || widths.length !== 4 || !widths.every((w) => isNum(w) && w >= 0)) return null;
  if (widths.every((w) => w === 0)) return null;
  const color = paintColor(style.borderColor);
  if (!color) return null;
  const rounded = widths.map((w) => round(w));
  const uniform = rounded.every((w) => w === rounded[0]);
  return { color, width: uniform ? rounded[0] : rounded };
};

/** Fill, stroke, radius, effects and opacity shared by frames. Returns the props and what was found. */
const visualProps = (style: DomStyle, box: DomBox, ctx: Ctx): { props: Props; visual: boolean } => {
  const props: Props = {};
  let visual = false;

  let fill: unknown = paintColor(style.backgroundColor) ?? undefined;
  const image = style.backgroundImage?.trim();
  if (image && image !== "none") {
    const layers = splitTop(image, ",");
    let used = false;
    for (const layer of layers) {
      if (used) {
        warn(ctx, "multiple background layers: only the top one was kept");
        break;
      }
      const gradient = parseLinearGradient(layer, Math.max(box.width, box.height));
      if (gradient) {
        fill = { type: "linear", angle: gradient.angle, stops: gradient.stops };
        used = true;
        continue;
      }
      const url = /^url\(\s*(["']?)(.*?)\1\s*\)$/is.exec(layer.trim())?.[2];
      if (url !== undefined) {
        if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url)) {
          try {
            fill = { type: "image", src: validateImageSrc(url), fit: "cover" };
            used = true;
            continue;
          } catch (error) {
            if (!(error instanceof ImageSrcError)) throw error;
          }
        }
        warn(ctx, "background image skipped (only embedded png/jpeg/webp/gif images are imported)");
        continue;
      }
      warn(ctx, `unsupported background skipped: ${layer.trim().slice(0, 40)}`);
    }
  }
  if (fill !== undefined) {
    props.fill = fill;
    visual = true;
  }

  const stroke = strokeOf(style);
  if (stroke) {
    props.stroke = stroke;
    visual = true;
  }
  if (isNum(style.borderRadius) && style.borderRadius > 0) {
    props.cornerRadius = round(style.borderRadius);
  }
  const { shadows, dropped } = parseBoxShadow(style.boxShadow);
  if (dropped > 0) warn(ctx, "some box shadows could not be read and were skipped");
  if (shadows.length > 0) {
    props.effects = shadows;
    visual = true;
  }
  if (isNum(style.opacity) && style.opacity < 1) props.opacity = round(Math.max(0, style.opacity));
  return { props, visual };
};

// --- validation ------------------------------------------------------------------

const KEEP = new Set(["type", "id", "children"]);

/**
 * Check a node (without its children) against the document schema. Props the schema rejects
 * are dropped with a warning; a node that stays invalid yields null.
 */
const sanitize = (raw: RawNode, ctx: Ctx): RawNode | null => {
  const { children, ...own } = raw;
  let current: RawNode = { ...own, id: "x", ...(children ? { children: [] } : {}) };
  for (let attempt = 0; attempt < 3; attempt++) {
    const parsed = nodeSchema.safeParse(current);
    if (parsed.success) {
      const out: RawNode = { ...raw };
      for (const key of Object.keys(own)) if (!(key in current)) delete out[key];
      return out;
    }
    const bad = new Set(
      parsed.error.issues
        .map((issue) => String(issue.path[0] ?? ""))
        .filter((k) => k && !KEEP.has(k)),
    );
    if (bad.size === 0) break;
    for (const key of bad) {
      delete current[key];
      warn(ctx, `dropped invalid "${key}" on ${String(raw.type)} "${String(raw.name ?? "")}"`);
    }
    current = { ...current };
  }
  warn(ctx, `skipped invalid ${String(raw.type)} "${String(raw.name ?? "")}"`);
  return null;
};

// --- conversion ------------------------------------------------------------------

const claim = (ctx: Ctx, amount = 1): boolean => {
  if (ctx.count + amount > ctx.max) {
    if (!ctx.capped) {
      ctx.capped = true;
      warn(ctx, `node limit reached (${ctx.max}): the rest of the page was skipped`);
    }
    return false;
  }
  ctx.count += amount;
  return true;
};

const place = (box: DomBox, origin: { x: number; y: number }) => ({
  x: round(box.x - origin.x),
  y: round(box.y - origin.y),
  width: round(box.width),
  height: round(box.height),
});

const textName = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > NAME_TEXT_LENGTH ? `${flat.slice(0, NAME_TEXT_LENGTH).trimEnd()}...` : flat;
};

const convertText = (
  node: Extract<DomSnapshotNode, { kind: "text" }>,
  origin: { x: number; y: number },
  ctx: Ctx,
): RawNode | null => {
  if (typeof node.text !== "string" || !validBox(node.box)) return null;
  const style = node.style ?? {};
  const content = applyTransform(
    node.text.replace(/\s+$/g, "").replace(/^\s+/g, ""),
    style.textTransform,
  );
  if (!content) return null;
  if (!claim(ctx)) return null;
  const size = isNum(style.fontSize) && style.fontSize > 0 ? round(style.fontSize) : undefined;
  const lineHeight =
    size && isNum(style.lineHeight) && style.lineHeight > 0
      ? round(style.lineHeight / size)
      : undefined;
  const pos = place(node.box, origin);
  const family = pickFontFamily(style.fontFamily);
  const fill = paintColor(style.color);
  const align = style.textAlign ? TEXT_ALIGN[style.textAlign] : undefined;
  const raw: RawNode = {
    type: "text",
    name: textName(content),
    x: pos.x,
    y: pos.y,
    // Fixed width = the measured box so wrapping matches; the height follows the text.
    width: Math.ceil(pos.width),
    content,
    ...(family ? { fontFamily: family } : {}),
    ...(size ? { fontSize: size } : {}),
    ...(isNum(style.fontWeight) ? { fontWeight: style.fontWeight } : {}),
    ...(style.fontStyle === "italic" ? { fontStyle: "italic" } : {}),
    ...(lineHeight ? { lineHeight } : {}),
    ...(isNum(style.letterSpacing) && style.letterSpacing !== 0
      ? { letterSpacing: round(style.letterSpacing) }
      : {}),
    ...(align ? { textAlign: align } : {}),
    ...(fill ? { fill } : {}),
    ...(isNum(style.opacity) && style.opacity < 1
      ? { opacity: round(Math.max(0, style.opacity)) }
      : {}),
  };
  return sanitize(raw, ctx);
};

const FIT: Record<string, string> = { cover: "crop", contain: "fit" };

const convertImage = (
  node: Extract<DomSnapshotNode, { kind: "image" }>,
  origin: { x: number; y: number },
  ctx: Ctx,
): RawNode | null => {
  if (!validBox(node.box)) return null;
  let src: string;
  try {
    src = validateImageSrc(String(node.src ?? ""));
  } catch (error) {
    if (!(error instanceof ImageSrcError)) throw error;
    warn(ctx, `image skipped: ${error.message}`);
    return null;
  }
  if (!claim(ctx)) return null;
  const style = node.style ?? {};
  const { props } = visualProps(
    { ...style, backgroundColor: undefined, backgroundImage: undefined, boxShadow: undefined },
    node.box,
    ctx,
  );
  const objectFit = style.objectFit;
  const alt = typeof node.alt === "string" && node.alt.trim() ? node.alt.slice(0, 500) : undefined;
  return sanitize(
    {
      type: "image",
      name: node.tag ? `${node.tag}${alt ? ` - ${textName(alt)}` : ""}` : "image",
      ...place(node.box, origin),
      src,
      fit: (objectFit && FIT[objectFit]) || "fill",
      ...(alt ? { alt } : {}),
      ...(props.cornerRadius !== undefined ? { cornerRadius: props.cornerRadius } : {}),
      ...(props.stroke ? { stroke: props.stroke } : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
    },
    ctx,
  );
};

const convertSvgNode = (
  node: Extract<DomSnapshotNode, { kind: "svg" }>,
  origin: { x: number; y: number },
  ctx: Ctx,
): RawNode | null => {
  if (!validBox(node.box)) return null;
  const box = node.box;
  try {
    let converted = convertSvg(String(node.markup ?? ""), { width: box.width, name: "svg" });
    if (converted.height > box.height + 0.5) {
      converted = convertSvg(String(node.markup ?? ""), {
        width: Math.max(1, (box.width * box.height) / converted.height),
        name: "svg",
      });
    }
    if (!claim(ctx, converted.nodeCount + 1)) return null;
    for (const w of converted.warnings) warn(ctx, `svg: ${w}`);
    const opacity =
      isNum(node.style?.opacity) && node.style.opacity < 1
        ? { opacity: round(Math.max(0, node.style.opacity)) }
        : {};
    // preserveAspectRatio default: centered inside the box.
    return {
      ...converted.node,
      x: round(box.x - origin.x + (box.width - converted.width) / 2),
      y: round(box.y - origin.y + (box.height - converted.height) / 2),
      ...opacity,
    };
  } catch (error) {
    if (error instanceof SvgError) {
      warn(ctx, `svg skipped: ${error.message}`);
      return null;
    }
    throw error;
  }
};

const elementName = (tag: string, component: string | undefined): string =>
  component ? `${component} - ${tag}` : tag;

const convertElement = (
  node: Extract<DomSnapshotNode, { kind: "element" }>,
  origin: { x: number; y: number },
  ctx: Ctx,
  depth: number,
  root?: { name: string; whiteFallback: boolean },
): RawNode | null => {
  if (!validBox(node.box)) {
    if (!root) return null;
  }
  const style = node.style ?? {};
  const box = validBox(node.box) ? node.box : { x: 0, y: 0, width: 1, height: 1 };
  const kids = Array.isArray(node.children) ? node.children : [];
  const { props, visual } = visualProps(style, box, ctx);
  if (root?.whiteFallback && props.fill === undefined) props.fill = "#ffffff";

  if (!root) {
    if (!visual && kids.length === 0) return null;
    const only = kids.length === 1 ? kids[0] : undefined;
    // A pointless wrapper: no visuals, one child with the same box.
    if (
      !visual &&
      !style.overflowHidden &&
      only &&
      only.box &&
      validBox(only.box) &&
      sameBox(only.box, box)
    ) {
      return convertAny(only, origin, ctx, depth + 1);
    }
  }
  if (!claim(ctx)) return null;

  const own = root
    ? { x: 0, y: 0, width: round(box.width), height: round(box.height) }
    : place(box, origin);
  const children: RawNode[] = [];
  if (depth >= MAX_DEPTH) {
    if (kids.length > 0) warn(ctx, `nesting deeper than ${MAX_DEPTH} levels was skipped`);
  } else {
    for (const child of kids) {
      const converted = convertAny(child, box, ctx, depth + 1);
      if (converted) children.push(converted);
    }
  }
  const raw: RawNode = {
    type: "frame",
    name: root?.name ?? elementName(String(node.tag ?? "div"), node.component),
    ...own,
    layout: "none",
    ...(root || style.overflowHidden ? { clip: true } : {}),
    ...props,
    children,
  };
  return sanitize(raw, ctx);
};

const convertAny = (
  node: DomSnapshotNode,
  origin: { x: number; y: number },
  ctx: Ctx,
  depth: number,
): RawNode | null => {
  if (!node || typeof node !== "object") return null;
  switch (node.kind) {
    case "element":
      return convertElement(node, origin, ctx, depth);
    case "text":
      return convertText(node, origin, ctx);
    case "image":
      return convertImage(node, origin, ctx);
    case "svg":
      return convertSvgNode(node, origin, ctx);
    default:
      return null;
  }
};

/**
 * Convert a page snapshot into one frame (clipped, absolute children). The frame sits at 0,0:
 * the caller positions it. Never throws on odd input; problems are returned as warnings.
 */
export const convertDomSnapshot = (
  snapshot: DomSnapshot,
  options: DomConversionOptions = {},
): DomConversion => {
  const ctx: Ctx = {
    count: 0,
    max: options.maxNodes ?? MAX_DOM_NODES,
    warnings: [],
    seen: new Set(),
    capped: false,
  };
  const root = snapshot?.root;
  const fallback: RawNode = {
    type: "frame",
    name: "Page",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    layout: "none",
    clip: true,
    children: [],
  };
  if (!root || typeof root !== "object" || !validBox(root.box)) {
    warn(ctx, "the page snapshot has no usable root box");
    return { node: fallback, warnings: ctx.warnings, count: 0 };
  }
  const fullPage =
    options.fullPage ?? (root.kind === "element" && (root.tag === "body" || root.tag === "html"));
  const title = typeof snapshot.title === "string" ? snapshot.title.trim() : "";
  const name = fullPage
    ? title || snapshot.url || "Page"
    : root.kind === "element"
      ? elementName(root.tag, root.component)
      : root.kind === "text"
        ? textName(root.text)
        : root.kind === "image"
          ? "image"
          : "svg";

  let node: RawNode | null;
  if (root.kind === "element") {
    node = convertElement(root, { x: root.box.x, y: root.box.y }, ctx, 0, {
      name: name.slice(0, 200),
      whiteFallback: fullPage,
    });
  } else {
    // A non-element root (text, image, svg): wrap it in a frame of its box.
    const child = convertAny(root, root.box, ctx, 1);
    const { props } = visualProps(root.style ?? {}, root.box, ctx);
    claim(ctx);
    node = sanitize(
      {
        type: "frame",
        name: name.slice(0, 200),
        x: 0,
        y: 0,
        width: round(root.box.width),
        height: round(root.box.height),
        layout: "none",
        clip: true,
        ...props,
        children: child ? [child] : [],
      },
      ctx,
    );
  }
  return { node: node ?? fallback, warnings: ctx.warnings, count: ctx.count };
};
