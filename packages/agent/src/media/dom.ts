/**
 * DOM snapshot -> Pego nodes. Pure: the browser host walks the page into a `DomSnapshot`, this
 * turns it into one raw frame (no ids yet, ready for `assignIds` + `parseNode`). Each container
 * becomes auto layout when Pego's own layout reproduces its children's measured boxes
 * (`dom-layout.ts`), else it keeps them at absolute positions. Odd input never throws; anything
 * that cannot be represented becomes a warning.
 */
import { nodeSchema } from "@pego/doc";
import type { DomBox, DomSnapshot, DomSnapshotNode, DomStyle } from "../browser-types";
import {
  layoutContainer,
  placeAbsolute,
  placeRaw,
  rootHeight,
  type Item,
  type ItemFacts,
} from "./dom-layout";
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
  /** The editor's font resolver (`ToolHost.resolveFont`); `pickFontFamily` when absent. */
  resolveFont?: (families: string[]) => string | undefined;
};

/** How many element containers became auto layout vs stayed absolute (`layout: "none"`). */
export type DomLayoutStats = { autoLayout: number; absolute: number };

export type DomConversion = {
  node: RawNode;
  warnings: string[];
  count: number;
  stats: DomLayoutStats;
};

type Ctx = {
  count: number;
  max: number;
  warnings: string[];
  seen: Set<string>;
  capped: boolean;
  stats: DomLayoutStats;
  resolveFont?: (families: string[]) => string | undefined;
  /** Font stack -> family, so the resolver runs once per stack. */
  fonts: Map<string, string | undefined>;
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

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** sRGB transfer function (also P3's): linear light -> encoded 0..255. */
const encode = (linear: number): number => {
  const v = clamp01(linear);
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
};

const decode = (encoded: number): number => {
  const v = Math.abs(encoded);
  const lin = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return encoded < 0 ? -lin : lin;
};

const fromLinear = (r: number, g: number, b: number, alpha: number): ParsedColor =>
  toHex(encode(r), encode(g), encode(b), alpha);

const oklabToColor = (l: number, a: number, b: number, alpha: number): ParsedColor => {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return fromLinear(
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    alpha,
  );
};

/** CIE Lab (D50, as CSS defines it) to sRGB. */
const labToColor = (l: number, a: number, b: number, alpha: number): ParsedColor => {
  const kappa = 24389 / 27;
  const eps = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = (fx ** 3 > eps ? fx ** 3 : (116 * fx - 16) / kappa) * 0.96422;
  const y = l > kappa * eps ? fy ** 3 : l / kappa;
  const z = (fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / kappa) * 0.82521;
  return fromLinear(
    3.1338561 * x - 1.6168667 * y - 0.4906146 * z,
    -0.9787684 * x + 1.9161415 * y + 0.033454 * z,
    0.0719453 * x - 0.2289914 * y + 1.4052427 * z,
    alpha,
  );
};

const hueDegrees = (token: string): number | null => {
  if (token === "none") return 0;
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(deg|grad|rad|turn)?$/.exec(token);
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

/** A number or percentage token (`none` = 0); a percentage maps 100% to `full`. */
const colorValue = (token: string | undefined, full: number): number | null => {
  if (token === undefined) return null;
  if (token === "none") return 0;
  const value = token.endsWith("%") ? (parseFloat(token) / 100) * full : parseFloat(token);
  return Number.isFinite(value) ? value : null;
};

/** `lab()`, `lch()`, `oklab()`, `oklch()` from their already split arguments. */
const parseLabFamily = (name: string, parts: string[]): ParsedColor | null => {
  if (parts.length < 3 || parts.length > 4) return null;
  const alpha = parts[3] === undefined ? 1 : colorValue(parts[3], 1);
  if (alpha === null) return null;
  const ok = name.startsWith("ok");
  const l = colorValue(parts[0], ok ? 1 : 100);
  if (l === null) return null;
  if (name.endsWith("lab")) {
    const a = colorValue(parts[1], ok ? 0.4 : 125);
    const b = colorValue(parts[2], ok ? 0.4 : 125);
    if (a === null || b === null) return null;
    return ok ? oklabToColor(l, a, b, alpha) : labToColor(l, a, b, alpha);
  }
  const c = colorValue(parts[1], ok ? 0.4 : 150);
  const h = hueDegrees(parts[2] ?? "");
  if (c === null || h === null) return null;
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  return ok ? oklabToColor(l, a, b, alpha) : labToColor(l, a, b, alpha);
};

/** `color(<space> r g b / a)` for srgb, srgb-linear and display-p3. */
const parseColorFn = (parts: string[]): ParsedColor | null => {
  const space = parts.shift();
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map((p) => colorValue(p, 1));
  const alpha = parts[3] === undefined ? 1 : colorValue(parts[3], 1);
  if (rgb.some((v) => v === null) || alpha === null) return null;
  const [r, g, b] = rgb as [number, number, number];
  switch (space) {
    case "srgb":
      return toHex(r * 255, g * 255, b * 255, alpha);
    case "srgb-linear":
      return fromLinear(r, g, b, alpha);
    case "display-p3": {
      const [lr, lg, lb] = [decode(r), decode(g), decode(b)] as [number, number, number];
      return fromLinear(
        1.2249401 * lr - 0.2249404 * lg,
        -0.0420569 * lr + 1.0420571 * lg,
        -0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb,
        alpha,
      );
    }
    default:
      return null;
  }
};

/**
 * Parse a CSS color (hex, rgb/rgba, `color(srgb | srgb-linear | display-p3 ...)`, `lab()`,
 * `lch()`, `oklab()`, `oklch()`, transparent, a few names). Wide-gamut colors are clamped to
 * sRGB. Returns null when it cannot be read. Fully transparent colors parse (alpha 0).
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
  const fn = /^(rgba?|color|lab|lch|oklab|oklch)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const name = fn[1] ?? "";
  const parts = (fn[2] ?? "").split(/[\s,/]+/).filter(Boolean);
  if (name === "color") return parseColorFn(parts);
  if (name !== "rgb" && name !== "rgba") return parseLabFamily(name, parts);
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map((p) => channel(p, 255));
  if (rgb.some((v) => v === null)) return null;
  const [r, g, b] = rgb as [number, number, number];
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

/** Color stops of a gradient (2+), positions as 0..1 fractions of `length` px; null if unreadable. */
const parseStops = (args: string[], length: number): Stop[] | null => {
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
  return flat.map(({ color, position }) => {
    const clamped = Math.min(1, Math.max(prev, position ?? prev));
    prev = clamped;
    return { color, position: round(clamped, 4) };
  });
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
  // Drop an interpolation clause ("in oklab", "to right in oklch shorter hue").
  if (args[0] !== undefined) {
    const direction = args[0].replace(/(^|\s)in\s+[a-z-]+(\s+\S+)*\s*$/i, "").trim();
    if (direction !== args[0].trim()) {
      if (direction) args[0] = direction;
      else args.shift();
    }
  }
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
  const stops = parseStops(args, length);
  if (!stops) return null;
  return { angle: round(((angle % 360) + 360) % 360, 2), stops };
};

/** Like paintColor, but fully transparent stays (gradient stops fade to transparent). */
const paintColorOrTransparent = (input: string | undefined): string | null =>
  parseColor(input)?.hex ?? null;

const SIZE_KEYWORDS = new Set([
  "closest-side",
  "closest-corner",
  "farthest-side",
  "farthest-corner",
]);

/** A position/size token in px: `%` of `full`, px or a bare number. Null if unreadable. */
const lengthPx = (token: string, full: number): number | null => {
  const m = /^(-?\d*\.?\d+)(%|px)?$/.exec(token);
  if (!m) return null;
  const n = parseFloat(m[1] ?? "");
  return m[2] === "%" ? (n / 100) * full : n;
};

/** `at <position>` (1 or 2 values: keywords, % or px) -> center in px, or null. */
const radialCenter = (tokens: string[], width: number, height: number): [number, number] | null => {
  const X: Record<string, number> = { left: 0, center: 0.5, right: 1 };
  const Y: Record<string, number> = { top: 0, center: 0.5, bottom: 1 };
  if (tokens.length === 0) return [width / 2, height / 2];
  if (tokens.length > 2) return null;
  let [a = "center", b = "center"] = tokens;
  // "top", "bottom left", "top 20%": a vertical keyword first means y comes first.
  if ((a === "top" || a === "bottom") && tokens.length === 1)
    return [width / 2, (Y[a] ?? 0.5) * height];
  if (a === "top" || a === "bottom" || b === "left" || b === "right") [a, b] = [b, a];
  const x = a in X ? (X[a] ?? 0.5) * width : lengthPx(a, width);
  const y = b in Y ? (Y[b] ?? 0.5) * height : lengthPx(b, height);
  return x === null || y === null ? null : [x, y];
};

/**
 * Parse one `radial-gradient(...)` layer for a box of `width` x `height` into Pego's radial fill
 * (center and radii as fractions of the box). Shapes circle/ellipse, size keywords, explicit
 * sizes and `at <position>` are supported; null when unreadable.
 */
export const parseRadialGradient = (
  layer: string,
  width: number,
  height: number,
): { center: [number, number]; radius: [number, number]; stops: Stop[] } | null => {
  const m = /^(repeating-)?radial-gradient\((.*)\)$/is.exec(layer.trim());
  if (!m || m[1] || !(width > 0) || !(height > 0)) return null;
  const args = splitTop(m[2] ?? "", ",");
  let shape: "circle" | "ellipse" | undefined;
  let size = "farthest-corner";
  const lengths: string[] = [];
  let at: string[] = [];
  const firstToken = splitTop(args[0] ?? "", " ")[0];
  if (args[0] !== undefined && !paintColorOrTransparent(firstToken)) {
    let tokens = splitTop(args.shift() ?? "", " ").map((t) => t.toLowerCase());
    // Drop an interpolation clause ("in oklab", "in oklch longer hue"), before or after "at".
    const inIdx = tokens.indexOf("in");
    if (inIdx >= 0) {
      const atAfter = tokens.indexOf("at", inIdx);
      tokens = [...tokens.slice(0, inIdx), ...(atAfter >= 0 ? tokens.slice(atAfter) : [])];
    }
    const atIdx = tokens.indexOf("at");
    if (atIdx >= 0) {
      at = tokens.slice(atIdx + 1);
      tokens = tokens.slice(0, atIdx);
    }
    for (const token of tokens) {
      if (token === "circle" || token === "ellipse") shape = token;
      else if (SIZE_KEYWORDS.has(token)) size = token;
      else if (lengthPx(token, 1) !== null) lengths.push(token);
      else return null;
    }
  }
  const center = radialCenter(at, width, height);
  if (!center || lengths.length > 2) return null;
  const [cx, cy] = center;
  const dx = [Math.abs(cx), Math.abs(width - cx)];
  const dy = [Math.abs(cy), Math.abs(height - cy)];
  const circle = shape === "circle" || (shape === undefined && lengths.length === 1);
  let rx: number;
  let ry: number;
  if (lengths.length > 0) {
    const a = lengthPx(lengths[0] ?? "", width);
    const b = lengths.length > 1 ? lengthPx(lengths[1] ?? "", height) : a;
    if (a === null || b === null) return null;
    [rx, ry] = circle ? [a, a] : [a, b];
  } else {
    const near = size.startsWith("closest");
    const pick = (values: number[]) => (near ? Math.min(...values) : Math.max(...values));
    if (size.endsWith("side")) {
      if (circle) rx = ry = pick([...dx, ...dy]);
      else [rx, ry] = [pick(dx), pick(dy)];
    } else if (circle) {
      rx = ry = Math.hypot(pick(dx), pick(dy));
    } else {
      // An ellipse through the corner with the aspect ratio of the matching *-side ellipse.
      [rx, ry] = [Math.SQRT2 * pick(dx), Math.SQRT2 * pick(dy)];
    }
  }
  const stops = parseStops(args, rx);
  if (!stops) return null;
  return {
    center: [round(cx / width, 4), round(cy / height, 4)],
    radius: [round(Math.max(0, rx) / width, 4), round(Math.max(0, ry) / height, 4)],
    stops,
  };
};

/** `background-size` -> image fill fit (a 100% 100% size stretches; auto and others cover). */
const imageFillFit = (size: string | undefined): "cover" | "contain" | "stretch" => {
  const first =
    splitTop(size ?? "", ",")[0]
      ?.trim()
      .toLowerCase() ?? "";
  if (first === "contain") return "contain";
  if (first === "100% 100%") return "stretch";
  return "cover";
};

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
      const radial = parseRadialGradient(layer, box.width, box.height);
      if (radial) {
        fill = { type: "radial", ...radial };
        used = true;
        continue;
      }
      const url = /^url\(\s*(["']?)(.*?)\1\s*\)$/is.exec(layer.trim())?.[2];
      if (url !== undefined) {
        if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(url)) {
          try {
            fill = {
              type: "image",
              src: validateImageSrc(url),
              fit: imageFillFit(style.backgroundSize),
            };
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

const textName = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > NAME_TEXT_LENGTH ? `${flat.slice(0, NAME_TEXT_LENGTH).trimEnd()}...` : flat;
};

const factsOf = (style: DomStyle): ItemFacts => {
  const margin = style.margin;
  const validMargin = Array.isArray(margin) && margin.length === 4 && margin.every(isNum);
  return {
    outOfFlow:
      /^(absolute|fixed|sticky)$/.test(String(style.position ?? "").toLowerCase()) ||
      (typeof style.float === "string" && style.float !== "none") ||
      style.transformed === true,
    flexGrow: isNum(style.flexGrow) && style.flexGrow > 0 ? style.flexGrow : 0,
    ...(typeof style.alignSelf === "string" && style.alignSelf !== "auto"
      ? { alignSelf: style.alignSelf }
      : {}),
    ...(validMargin ? { margin } : {}),
  };
};

/** A collapsed wrapper is the real flex/flow item: its facts win, out-of-flow is sticky. */
const mergeFacts = (outer: ItemFacts, inner: ItemFacts): ItemFacts => ({
  ...outer,
  outOfFlow: outer.outOfFlow || inner.outOfFlow,
  ...(outer.margin ? {} : inner.margin ? { margin: inner.margin } : {}),
});

/** Font family for a CSS stack: the host's resolver first, then `pickFontFamily`. */
const fontFamilyFor = (stack: string | undefined, ctx: Ctx): string | undefined => {
  if (!stack) return undefined;
  if (ctx.fonts.has(stack)) return ctx.fonts.get(stack);
  let family: string | undefined;
  if (ctx.resolveFont) {
    const families = splitTop(stack, ",")
      .map((f) => f.replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
    try {
      const resolved = ctx.resolveFont(families);
      if (typeof resolved === "string" && resolved.trim()) family = resolved.trim();
    } catch {
      // A failing resolver only loses the better match.
    }
  }
  family ??= pickFontFamily(stack);
  ctx.fonts.set(stack, family);
  return family;
};

const convertText = (node: Extract<DomSnapshotNode, { kind: "text" }>, ctx: Ctx): Item | null => {
  if (typeof node.text !== "string" || !validBox(node.box)) return null;
  const style = node.style ?? {};
  // Paragraphs are trimmed; inline runs keep the edge space the page script left between runs,
  // as a no-break space: the text renderer does not count a trailing plain space in the width.
  const text = node.merged
    ? node.text.trim()
    : node.text.replace(/^\n+|\n+$/g, "").replace(/^ | $/g, "\u00a0");
  const content = applyTransform(text, style.textTransform);
  if (!content.trim()) return null;
  if (!claim(ctx)) return null;
  const size = isNum(style.fontSize) && style.fontSize > 0 ? round(style.fontSize) : undefined;
  const lineHeight =
    size && isNum(style.lineHeight) && style.lineHeight > 0
      ? round(style.lineHeight / size)
      : undefined;
  // One line in the page: let the text measure itself, so a wider fallback font overflows
  // a little instead of wrapping onto a second line. Several lines get a width (the parent
  // decides: fixed, or fill_container in a stack so edits reflow).
  const lineBox = (lineHeight ?? 1.25) * (size ?? 16);
  const multiLine = node.box.height >= lineBox * 1.5;
  const whiteSpace = String(style.whiteSpace ?? "").toLowerCase();
  const family = fontFamilyFor(style.fontFamily, ctx);
  const fill = paintColor(style.color);
  const align = style.textAlign ? TEXT_ALIGN[style.textAlign] : undefined;
  const raw = sanitize(
    {
      type: "text",
      name: textName(content),
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
    },
    ctx,
  );
  if (!raw) return null;
  return {
    raw,
    box: node.box,
    kind: "text",
    auto: false,
    // Merged paragraphs carry their block's flow facts (margin, flex-grow, float...).
    facts: factsOf(style),
    text: {
      multiLine,
      noWrap: whiteSpace === "nowrap" || whiteSpace === "pre",
      align: align ?? "left",
      fontSize: size ?? 16,
      lineHeight: lineBox,
    },
  };
};

const FIT: Record<string, string> = { cover: "crop", contain: "fit" };

const convertImage = (node: Extract<DomSnapshotNode, { kind: "image" }>, ctx: Ctx): Item | null => {
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
  const raw = sanitize(
    {
      type: "image",
      name: node.tag ? `${node.tag}${alt ? ` - ${textName(alt)}` : ""}` : "image",
      src,
      fit: (objectFit && FIT[objectFit]) || "fill",
      ...(alt ? { alt } : {}),
      ...(props.cornerRadius !== undefined ? { cornerRadius: props.cornerRadius } : {}),
      ...(props.stroke ? { stroke: props.stroke } : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
    },
    ctx,
  );
  return raw ? { raw, box: node.box, kind: "image", auto: false, facts: factsOf(style) } : null;
};

const convertSvgNode = (node: Extract<DomSnapshotNode, { kind: "svg" }>, ctx: Ctx): Item | null => {
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
      raw: { ...converted.node, ...opacity },
      box: {
        x: box.x + (box.width - converted.width) / 2,
        y: box.y + (box.height - converted.height) / 2,
        width: converted.width,
        height: converted.height,
      },
      kind: "vector",
      auto: false,
      facts: factsOf(node.style ?? {}),
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
  ctx: Ctx,
  depth: number,
  root?: { name: string; whiteFallback: boolean },
): Item | null => {
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
      depth < MAX_DEPTH &&
      !visual &&
      props.opacity === undefined &&
      !style.overflowHidden &&
      only &&
      only.box &&
      validBox(only.box) &&
      sameBox(only.box, box)
    ) {
      const inner = convertAny(only, ctx, depth + 1);
      return inner ? { ...inner, facts: mergeFacts(factsOf(style), inner.facts) } : null;
    }
  }
  if (!claim(ctx)) return null;

  const items: Item[] = [];
  if (depth >= MAX_DEPTH) {
    if (kids.length > 0) warn(ctx, `nesting deeper than ${MAX_DEPTH} levels was skipped`);
  } else {
    for (const child of kids) {
      const converted = convertAny(child, ctx, depth + 1);
      if (converted) items.push(converted);
    }
  }
  const laid = layoutContainer(box, style, items);
  if (items.length > 0) {
    if (laid.auto) ctx.stats.autoLayout++;
    else ctx.stats.absolute++;
  }
  const raw = sanitize(
    {
      type: "frame",
      name: root?.name ?? elementName(String(node.tag ?? "div"), node.component),
      ...laid.props,
      ...(root || style.overflowHidden ? { clip: true } : {}),
      ...props,
      children: laid.children,
    },
    ctx,
  );
  if (!raw) return null;
  return {
    raw,
    box,
    kind: "frame",
    auto: laid.auto,
    ...(laid.hug ? { hug: laid.hug } : {}),
    facts: factsOf(style),
  };
};

const convertAny = (node: DomSnapshotNode, ctx: Ctx, depth: number): Item | null => {
  if (!node || typeof node !== "object") return null;
  switch (node.kind) {
    case "element":
      return convertElement(node, ctx, depth);
    case "text":
      return convertText(node, ctx);
    case "image":
      return convertImage(node, ctx);
    case "svg":
      return convertSvgNode(node, ctx);
    default:
      return null;
  }
};

/**
 * Convert a page snapshot into one clipped frame at 0,0 (the caller positions it). Containers
 * become verified auto layout where possible, absolute elsewhere (`stats` counts both). Never
 * throws on odd input; problems are returned as warnings.
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
    stats: { autoLayout: 0, absolute: 0 },
    resolveFont: options.resolveFont,
    fonts: new Map(),
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
  const done = (node: RawNode | null): DomConversion => ({
    node: node ?? fallback,
    warnings: ctx.warnings,
    count: ctx.count,
    stats: ctx.stats,
  });
  if (!root || typeof root !== "object" || !validBox(root.box)) {
    warn(ctx, "the page snapshot has no usable root box");
    return { ...done(fallback), count: 0 };
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

  if (root.kind === "element") {
    const item = convertElement(root, ctx, 0, {
      name: name.slice(0, 200),
      whiteFallback: fullPage,
    });
    if (!item) return done(null);
    // The root keeps the page/element width; its height hugs when the stack reproduces it.
    return done(
      placeRaw(
        item.raw,
        { x: 0, y: 0 },
        { width: round(root.box.width), height: rootHeight(item) },
      ),
    );
  }
  // A non-element root (text, image, svg): wrap it in a frame of its box.
  const child = convertAny(root, ctx, 1);
  const { props } = visualProps(root.style ?? {}, root.box, ctx);
  claim(ctx);
  return done(
    sanitize(
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
        children: child ? placeAbsolute(root.box, [child]) : [],
      },
      ctx,
    ),
  );
};
