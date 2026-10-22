import { MAX_DATA_URL_LENGTH, validateImageSrc } from "./image-src";
import {
  apply,
  ellipseSegments,
  IDENTITY,
  isAxisAligned,
  meanScale,
  multiply,
  parseNumbers,
  parsePathData,
  parseTransform,
  pointsSegments,
  rectSegments,
  segmentBounds,
  serializeSegments,
  transformSegments,
  type Matrix,
  type Segment,
} from "./svg-geometry";
import {
  assertSafeCss,
  parseColor,
  parseLength,
  parseStyleAttribute,
  urlReference,
  withAlpha,
} from "./svg-style";
import { parseXml, type XmlElement } from "./xml";

export const MAX_SVG_BYTES = 512 * 1024;
export const MAX_SVG_NODES = 2000;
const MAX_SVG_SIZE = 10000;
const MAX_USE_DEPTH = 8;

/** A node without ids, ready for `assignIds` + `parseNode`. */
export type RawNode = Record<string, unknown>;

export type SvgConversion = {
  node: RawNode;
  width: number;
  height: number;
  nodeCount: number;
  warnings: string[];
};

/** Unsafe or unusable input. `code` is a stable tool error code. */
export class SvgError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SvgError";
    this.code = code;
  }
}

const FORBIDDEN_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "canvas",
]);
const IGNORED_TAGS = new Set([
  "defs",
  "title",
  "desc",
  "metadata",
  "lineargradient",
  "radialgradient",
  "clippath",
  "mask",
  "filter",
  "pattern",
  "marker",
  "symbol",
  "style",
  "sodipodi:namedview",
  "animate",
  "animatetransform",
  "animatemotion",
  "set",
]);
const HREF_ATTRS = new Set(["href", "xlink:href", "src"]);

/** Reject anything that can execute code or reach outside the document. */
const assertSafeTree = (el: XmlElement): void => {
  const tag = el.tag.toLowerCase().replace(/^svg:/, "");
  if (FORBIDDEN_TAGS.has(tag)) {
    throw new SvgError("unsafe_svg", `<${el.tag}> is not allowed in SVG input`);
  }
  for (const [name, value] of Object.entries(el.attrs)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on")) {
      throw new SvgError("unsafe_svg", `event attribute "${name}" is not allowed in SVG input`);
    }
    if (/javascript:|vbscript:|data:text\/html/i.test(value)) {
      throw new SvgError("unsafe_svg", `attribute "${name}" contains a script URL`);
    }
    if (HREF_ATTRS.has(lower)) {
      const target = value.trim();
      const internal = target.startsWith("#");
      const embeddedImage = tag === "image" && /^data:image\//i.test(target);
      if (!internal && !embeddedImage) {
        throw new SvgError(
          "unsafe_svg",
          `external reference in "${name}" is not allowed (only #id links and data:image on <image>)`,
        );
      }
    }
    if (lower === "style" || lower === "clip-path" || lower === "mask" || lower === "filter") {
      try {
        assertSafeCss(value);
      } catch (error) {
        throw new SvgError("unsafe_svg", error instanceof Error ? error.message : "unsafe style");
      }
    }
  }
  if (tag === "style") {
    try {
      assertSafeCss(el.text);
    } catch (error) {
      throw new SvgError("unsafe_svg", error instanceof Error ? error.message : "unsafe style");
    }
  }
  el.children.forEach(assertSafeTree);
};

// --- inherited style -----------------------------------------------------------------

type Inherited = {
  /** Resolved hex color or null for none. */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  linecap: string | undefined;
  linejoin: string | undefined;
  color: string;
  fontFamily: string | undefined;
  fontSize: number;
  fontWeight: number | undefined;
  fontStyle: string | undefined;
  textAnchor: string;
};

type Context = { matrix: Matrix; style: Inherited; useDepth: number };

type State = {
  count: number;
  warnings: Set<string>;
  ids: Map<string, XmlElement>;
};

const INITIAL_STYLE: Inherited = {
  fill: "#000000",
  stroke: null,
  strokeWidth: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  linecap: undefined,
  linejoin: undefined,
  color: "#000000",
  fontFamily: undefined,
  fontSize: 16,
  fontWeight: undefined,
  fontStyle: undefined,
  textAnchor: "start",
};

const props = (el: XmlElement): Record<string, string> => {
  const style = el.attrs.style ? parseStyleAttribute(el.attrs.style) : {};
  return { ...el.attrs, ...style };
};

const number = (value: string | undefined, fallback: number): number => {
  const parsed = parseLength(value);
  return parsed === null ? fallback : parsed;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const gradientColor = (state: State, id: string, depth = 0): string | null => {
  const gradient = state.ids.get(id);
  if (!gradient || depth > 4) return null;
  const stop = gradient.children.find((child) => child.tag === "stop");
  if (stop) {
    const p = props(stop);
    const base = parseColor(p["stop-color"] ?? "#000000") ?? "#000000";
    return withAlpha(base, clamp01(number(p["stop-opacity"], 1)));
  }
  const link = (gradient.attrs.href ?? gradient.attrs["xlink:href"])?.trim();
  return link?.startsWith("#") ? gradientColor(state, link.slice(1), depth + 1) : null;
};

const resolvePaint = (
  value: string,
  inherited: Inherited,
  state: State,
  label: string,
): string | null => {
  const trimmed = value.trim();
  if (trimmed === "none" || trimmed === "transparent") return null;
  if (trimmed === "currentColor") return inherited.color;
  const ref = urlReference(trimmed);
  if (ref) {
    const color = gradientColor(state, ref);
    state.warnings.add(
      color
        ? `${label}: gradient/pattern fills are not supported, used the first stop color`
        : `${label}: paint server "${ref}" not found or unsupported, left unpainted`,
    );
    return color;
  }
  const color = parseColor(trimmed);
  if (!color) state.warnings.add(`${label}: unsupported color "${trimmed}", left unpainted`);
  return color;
};

const inheritStyle = (el: XmlElement, parent: Inherited, state: State): Inherited => {
  const p = props(el);
  const next: Inherited = { ...parent };
  if (p.color) next.color = parseColor(p.color) ?? parent.color;
  const label = `<${el.tag}>`;
  if (p.fill !== undefined) next.fill = resolvePaint(p.fill, next, state, label);
  if (p.stroke !== undefined) next.stroke = resolvePaint(p.stroke, next, state, label);
  if (p["stroke-width"] !== undefined) next.strokeWidth = number(p["stroke-width"], 1);
  if (p["fill-opacity"] !== undefined) next.fillOpacity = clamp01(number(p["fill-opacity"], 1));
  if (p["stroke-opacity"] !== undefined) {
    next.strokeOpacity = clamp01(number(p["stroke-opacity"], 1));
  }
  if (p["stroke-linecap"]) next.linecap = p["stroke-linecap"];
  if (p["stroke-linejoin"]) next.linejoin = p["stroke-linejoin"];
  if (p["font-family"]) {
    next.fontFamily = p["font-family"]
      .split(",")[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, "");
  }
  if (p["font-size"]) next.fontSize = number(p["font-size"], parent.fontSize);
  if (p["font-weight"]) {
    const weight =
      p["font-weight"] === "bold"
        ? 700
        : p["font-weight"] === "normal"
          ? 400
          : Number(p["font-weight"]);
    if (Number.isFinite(weight)) next.fontWeight = weight;
  }
  if (p["font-style"]) next.fontStyle = p["font-style"];
  if (p["text-anchor"]) next.textAnchor = p["text-anchor"];
  if (p["fill-rule"] === "evenodd") {
    state.warnings.add(`${label}: fill-rule evenodd is not supported (nonzero is used)`);
  }
  if (p["stroke-dasharray"] && p["stroke-dasharray"] !== "none") {
    state.warnings.add(`${label}: stroke-dasharray is not supported, strokes are solid`);
  }
  for (const feature of ["clip-path", "mask", "filter"]) {
    if (p[feature] && p[feature] !== "none") {
      state.warnings.add(`${label}: ${feature} is not supported and was ignored`);
    }
  }
  if (p["marker-start"] || p["marker-mid"] || p["marker-end"]) {
    state.warnings.add(`${label}: markers are not supported and were ignored`);
  }
  return next;
};

// --- node building --------------------------------------------------------------------

const round = (n: number): number => Math.round(n * 1000) / 1000 || 0;

const emit = (state: State): void => {
  state.count += 1;
  if (state.count > MAX_SVG_NODES) {
    throw new SvgError("svg_too_complex", `SVG would create more than ${MAX_SVG_NODES} nodes`);
  }
};

const nameOf = (el: XmlElement): string => el.attrs.id ?? el.attrs["inkscape:label"] ?? el.tag;

const withOpacity = (node: RawNode, el: XmlElement): RawNode => {
  const opacity = props(el).opacity;
  if (opacity === undefined) return node;
  const value = clamp01(number(opacity, 1));
  return value < 1 ? { ...node, opacity: round(value) } : node;
};

const paintProps = (ctx: Context, scale: number, strokeless = false): RawNode => {
  const { style } = ctx;
  const out: RawNode = {};
  if (style.fill) out.fill = withAlpha(style.fill, style.fillOpacity);
  const width = style.strokeWidth * scale;
  if (!strokeless && style.stroke && width > 0) {
    out.stroke = { color: withAlpha(style.stroke, style.strokeOpacity), width: round(width) };
  }
  return out;
};

const strokeStyleProps = (ctx: Context): RawNode => {
  const out: RawNode = {};
  const { linecap, linejoin } = ctx.style;
  if (linecap === "butt" || linecap === "round" || linecap === "square") out.strokeCap = linecap;
  if (linejoin === "round" || linejoin === "bevel") out.strokeJoin = linejoin;
  else if (linejoin === "miter" || linejoin === "miter-clip" || linejoin === "arcs") {
    out.strokeJoin = "miter";
  }
  return out;
};

const pathNode = (el: XmlElement, segments: Segment[], ctx: Context): RawNode[] => {
  const moved = transformSegments(segments, ctx.matrix);
  const bounds = segmentBounds(moved);
  if (!bounds) return [];
  const paint = paintProps(ctx, meanScale(ctx.matrix));
  if (!paint.fill && !paint.stroke) return [];
  return [
    withOpacity(
      {
        type: "path",
        name: nameOf(el),
        x: round(bounds.x),
        y: round(bounds.y),
        width: round(bounds.width),
        height: round(bounds.height),
        geometry: serializeSegments(moved, bounds.x, bounds.y),
        ...paint,
        ...(paint.stroke ? strokeStyleProps(ctx) : {}),
      },
      el,
    ),
  ];
};

const rectNode = (el: XmlElement, ctx: Context, state: State): RawNode[] => {
  const x = number(el.attrs.x, 0);
  const y = number(el.attrs.y, 0);
  const w = number(el.attrs.width, 0);
  const h = number(el.attrs.height, 0);
  if (w <= 0 || h <= 0) return [];
  const rxAttr = parseLength(el.attrs.rx);
  const ryAttr = parseLength(el.attrs.ry);
  const rx = Math.max(0, rxAttr ?? ryAttr ?? 0);
  const ry = Math.max(0, ryAttr ?? rxAttr ?? 0);
  const m = ctx.matrix;
  const circularCorners = Math.abs(rx * Math.abs(m[0]) - ry * Math.abs(m[3])) < 1e-6;
  if (isAxisAligned(m) && circularCorners) {
    const a = apply(m, { x, y });
    const b = apply(m, { x: x + w, y: y + h });
    const paint = paintProps(ctx, meanScale(m));
    if (!paint.fill && !paint.stroke) return [];
    emit(state);
    return [
      withOpacity(
        {
          type: "rectangle",
          name: nameOf(el),
          x: round(Math.min(a.x, b.x)),
          y: round(Math.min(a.y, b.y)),
          width: round(Math.abs(b.x - a.x)),
          height: round(Math.abs(b.y - a.y)),
          ...(rx > 0
            ? {
                cornerRadius: round(
                  Math.min(rx * Math.abs(m[0]), Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2),
                ),
              }
            : {}),
          ...paint,
        },
        el,
      ),
    ];
  }
  emit(state);
  return pathNode(el, rectSegments(x, y, w, h, rx, ry), ctx);
};

const ellipseNode = (el: XmlElement, ctx: Context, state: State): RawNode[] => {
  const cx = number(el.attrs.cx, 0);
  const cy = number(el.attrs.cy, 0);
  const rx =
    el.tag === "circle" ? number(el.attrs.r, 0) : number(el.attrs.rx, number(el.attrs.ry, 0));
  const ry = el.tag === "circle" ? rx : number(el.attrs.ry, number(el.attrs.rx, 0));
  if (rx <= 0 || ry <= 0) return [];
  const m = ctx.matrix;
  emit(state);
  if (isAxisAligned(m)) {
    const a = apply(m, { x: cx - rx, y: cy - ry });
    const b = apply(m, { x: cx + rx, y: cy + ry });
    const paint = paintProps(ctx, meanScale(m));
    if (!paint.fill && !paint.stroke) return [];
    return [
      withOpacity(
        {
          type: "ellipse",
          name: nameOf(el),
          x: round(Math.min(a.x, b.x)),
          y: round(Math.min(a.y, b.y)),
          width: round(Math.abs(b.x - a.x)),
          height: round(Math.abs(b.y - a.y)),
          ...paint,
        },
        el,
      ),
    ];
  }
  return pathNode(el, ellipseSegments(cx, cy, rx, ry), ctx);
};

const textContent = (el: XmlElement, state: State): string => {
  const parts: string[] = [el.text];
  const walk = (node: XmlElement) => {
    for (const child of node.children) {
      if (child.tag === "tspan" || child.tag === "textPath") {
        if (child.attrs.y !== undefined || child.attrs.dy !== undefined) {
          state.warnings.add("<text>: multi-line tspans were flattened into one line");
        }
        parts.push(child.text);
        walk(child);
      }
    }
  };
  walk(el);
  return parts.join("").replace(/\s+/g, " ").trim();
};

const textNode = (el: XmlElement, ctx: Context, state: State): RawNode[] => {
  const content = textContent(el, state);
  if (!content || !ctx.style.fill) return [];
  state.warnings.add("<text>: text position and width are approximate; check fonts after insert");
  const m = ctx.matrix;
  if (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6) {
    state.warnings.add("<text>: rotation/skew of text was ignored");
  }
  const scale = meanScale(m);
  const size = ctx.style.fontSize * scale;
  const [x = 0] = parseNumbers(el.attrs.x ?? "0");
  const [y = 0] = parseNumbers(el.attrs.y ?? "0");
  const anchor = apply(m, { x, y });
  const estimatedWidth = content.length * size * 0.55;
  const shift =
    ctx.style.textAnchor === "middle"
      ? estimatedWidth / 2
      : ctx.style.textAnchor === "end"
        ? estimatedWidth
        : 0;
  emit(state);
  const { style } = ctx;
  return [
    withOpacity(
      {
        type: "text",
        name: content.slice(0, 40),
        content,
        x: round(anchor.x - shift),
        y: round(anchor.y - size * 0.8),
        fontSize: round(size),
        fill: withAlpha(style.fill ?? "#000000", style.fillOpacity),
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
        ...(style.fontStyle === "italic" || style.fontStyle === "oblique"
          ? { fontStyle: "italic" }
          : {}),
        ...(style.textAnchor === "middle" ? { textAlign: "center" } : {}),
        ...(style.textAnchor === "end" ? { textAlign: "right" } : {}),
      },
      el,
    ),
  ];
};

const imageNode = (el: XmlElement, ctx: Context, state: State): RawNode[] => {
  const href = (el.attrs.href ?? el.attrs["xlink:href"] ?? "").trim();
  if (href.length > MAX_DATA_URL_LENGTH) {
    throw new SvgError("svg_too_complex", "embedded image is too large");
  }
  let src: string;
  try {
    src = validateImageSrc(href);
  } catch (error) {
    throw new SvgError(
      "unsafe_svg",
      `<image>: ${error instanceof Error ? error.message : "bad src"}`,
    );
  }
  const m = ctx.matrix;
  if (!isAxisAligned(m)) state.warnings.add("<image>: rotation/skew of images was ignored");
  const x = number(el.attrs.x, 0);
  const y = number(el.attrs.y, 0);
  const w = number(el.attrs.width, 0);
  const h = number(el.attrs.height, 0);
  if (w <= 0 || h <= 0) return [];
  const a = apply(m, { x, y });
  const b = apply(m, { x: x + w, y: y + h });
  emit(state);
  const slice = /slice/.test(el.attrs.preserveAspectRatio ?? "");
  return [
    withOpacity(
      {
        type: "image",
        name: nameOf(el),
        src,
        fit: slice || el.attrs.preserveAspectRatio === "none" ? "fill" : "fit",
        x: round(Math.min(a.x, b.x)),
        y: round(Math.min(a.y, b.y)),
        width: round(Math.abs(b.x - a.x)),
        height: round(Math.abs(b.y - a.y)),
      },
      el,
    ),
  ];
};

const elementMatrix = (el: XmlElement, parent: Matrix, state: State): Matrix => {
  const transform = el.attrs.transform ?? props(el).transform;
  if (!transform) return parent;
  const { matrix, unsupported } = parseTransform(transform);
  for (const name of unsupported) {
    state.warnings.add(`transform ${name}() is not supported and was ignored`);
  }
  return multiply(parent, matrix);
};

const hidden = (el: XmlElement): boolean => {
  const p = props(el);
  return p.display === "none" || p.visibility === "hidden" || p.visibility === "collapse";
};

const convertChildren = (el: XmlElement, ctx: Context, state: State): RawNode[] =>
  el.children.flatMap((child) => convertElement(child, ctx, state));

const convertElement = (el: XmlElement, parent: Context, state: State): RawNode[] => {
  const tag = el.tag.toLowerCase().replace(/^svg:/, "");
  if (IGNORED_TAGS.has(tag)) {
    if (tag === "style") state.warnings.add("<style> CSS rules are not applied (use attributes)");
    else if (["filter", "mask", "clippath", "pattern", "marker"].includes(tag)) {
      // Reported where referenced; defs themselves are silently skipped.
    }
    return [];
  }
  if (hidden(el)) return [];
  const ctx: Context = {
    matrix: elementMatrix(el, parent.matrix, state),
    style: inheritStyle(el, parent.style, state),
    useDepth: parent.useDepth,
  };

  switch (tag) {
    case "g":
    case "a":
    case "svg":
    case "switch": {
      if (tag === "svg" && (el.attrs.viewBox || el.attrs.x || el.attrs.y)) {
        state.warnings.add("nested <svg>: x/y/viewBox were ignored");
      }
      const children = convertChildren(el, ctx, state);
      if (children.length === 0) return [];
      emit(state);
      return [withOpacity({ type: "group", name: nameOf(el), children }, el)];
    }
    case "use": {
      const href = (el.attrs.href ?? el.attrs["xlink:href"] ?? "").trim();
      const target = state.ids.get(href.slice(1));
      if (!target || ctx.useDepth >= MAX_USE_DEPTH) {
        state.warnings.add(`<use> target "${href}" was not found or nested too deeply`);
        return [];
      }
      const moved: Context = {
        ...ctx,
        matrix: multiply(ctx.matrix, [1, 0, 0, 1, number(el.attrs.x, 0), number(el.attrs.y, 0)]),
        useDepth: ctx.useDepth + 1,
      };
      const targetTag = target.tag.toLowerCase();
      const children =
        targetTag === "symbol"
          ? convertChildren(target, moved, state)
          : convertElement(target, moved, state);
      if (children.length === 0) return [];
      emit(state);
      return [withOpacity({ type: "group", name: nameOf(el), children }, el)];
    }
    case "rect":
      return rectNode(el, ctx, state);
    case "circle":
    case "ellipse":
      return ellipseNode(el, ctx, state);
    case "line": {
      const segments: Segment[] = [
        { type: "M", p: { x: number(el.attrs.x1, 0), y: number(el.attrs.y1, 0) } },
        { type: "L", p: { x: number(el.attrs.x2, 0), y: number(el.attrs.y2, 0) } },
      ];
      emit(state);
      return pathNode(el, segments, { ...ctx, style: { ...ctx.style, fill: null } });
    }
    case "polyline":
    case "polygon": {
      const segments = pointsSegments(el.attrs.points ?? "", tag === "polygon");
      if (segments.length < 2) return [];
      emit(state);
      return pathNode(el, segments, ctx);
    }
    case "path": {
      let segments: Segment[];
      try {
        segments = parsePathData(el.attrs.d ?? "");
      } catch (error) {
        state.warnings.add(
          `<path ${el.attrs.id ?? ""}>: skipped, ${error instanceof Error ? error.message : "bad path data"}`,
        );
        return [];
      }
      emit(state);
      return pathNode(el, segments, ctx);
    }
    case "text":
      return textNode(el, ctx, state);
    case "image":
      return imageNode(el, ctx, state);
    default:
      state.warnings.add(`<${el.tag}> is not supported and was skipped`);
      return [];
  }
};

const collectIds = (el: XmlElement, into: Map<string, XmlElement>): void => {
  if (el.attrs.id && !into.has(el.attrs.id)) into.set(el.attrs.id, el);
  el.children.forEach((child) => collectIds(child, into));
};

export type SvgOptions = {
  /** Target width in pixels. Height follows the viewBox aspect ratio. */
  width?: number;
  name?: string;
};

/**
 * Convert SVG markup into one frame node (clipped to the viewBox) of editable Pego nodes.
 * Throws SvgError for oversized, malformed or unsafe input; unsupported features become warnings.
 */
export const convertSvg = (source: string, options: SvgOptions = {}): SvgConversion => {
  if (new TextEncoder().encode(source).length > MAX_SVG_BYTES) {
    throw new SvgError("svg_too_large", `SVG is larger than ${MAX_SVG_BYTES / 1024} KB`);
  }
  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (error) {
    throw new SvgError("invalid_svg", error instanceof Error ? error.message : "cannot parse SVG");
  }
  if (root.tag.toLowerCase().replace(/^svg:/, "") !== "svg") {
    throw new SvgError("invalid_svg", `root element must be <svg>, got <${root.tag}>`);
  }
  assertSafeTree(root);

  const state: State = { count: 0, warnings: new Set(), ids: new Map() };
  collectIds(root, state.ids);

  const viewBox = parseNumbers(root.attrs.viewBox ?? "");
  const attrW = parseLength(root.attrs.width);
  const attrH = parseLength(root.attrs.height);
  let [vbX, vbY, vbW, vbH] =
    viewBox.length === 4 ? (viewBox as [number, number, number, number]) : [0, 0, 0, 0];
  if (!(vbW > 0 && vbH > 0)) {
    vbX = 0;
    vbY = 0;
    vbW = attrW ?? 0;
    vbH = attrH ?? 0;
    if (!(vbW > 0 && vbH > 0)) {
      state.warnings.add("svg has no viewBox or width/height, assumed 100x100");
      vbW = 100;
      vbH = 100;
    }
  }
  const targetW = options.width ?? attrW ?? vbW;
  if (!(targetW > 0) || targetW > MAX_SVG_SIZE) {
    throw new SvgError("invalid_svg", `width must be between 0 and ${MAX_SVG_SIZE}`);
  }
  const scale = targetW / vbW;
  const targetH = vbH * scale;
  if (targetH > MAX_SVG_SIZE) {
    throw new SvgError("invalid_svg", `resulting height exceeds ${MAX_SVG_SIZE}`);
  }

  const base: Matrix = multiply(IDENTITY, [scale, 0, 0, scale, -vbX * scale, -vbY * scale]);
  const style = inheritStyle(root, INITIAL_STYLE, state);
  const children = convertChildren(root, { matrix: base, style, useDepth: 0 }, state);
  emit(state);
  const node: RawNode = {
    type: "frame",
    name: options.name ?? (root.attrs.id || "SVG"),
    width: round(targetW),
    height: round(targetH),
    clip: true,
    children,
  };
  return {
    node,
    width: round(targetW),
    height: round(targetH),
    nodeCount: state.count,
    warnings: [...state.warnings],
  };
};
