/** SVG <linearGradient> / <radialGradient> to Pego gradient fills (pure, no DOM). */
import { linearGradientPoints } from "@pego/doc";
import { apply, IDENTITY, multiply, parseTransform, type Matrix, type Point } from "./svg-geometry";
import { parseColor, parseLength, withAlpha } from "./svg-style";
import type { XmlElement } from "./xml";

type Stop = { color: string; position: number };
type Box = { x: number; y: number; width: number; height: number };
export type GradientFill =
  | { type: "linear"; angle: number; stops: Stop[] }
  | { type: "radial"; center: [number, number]; radius: [number, number]; stops: Stop[] };

const MAX_HREF_DEPTH = 8;
const EPSILON = 1e-9;

const tagOf = (el: XmlElement): string => el.tag.toLowerCase().replace(/^svg:/, "");
const round = (n: number): number => Math.round(n * 1000) / 1000 || 0;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The gradient element `id` with attributes and stops inherited through its href chain. */
const resolveChain = (
  ids: Map<string, XmlElement>,
  id: string,
): { tag: string; attrs: Record<string, string>; stops: XmlElement[] } | null => {
  const first = ids.get(id);
  if (!first) return null;
  const tag = tagOf(first);
  if (tag !== "lineargradient" && tag !== "radialgradient") return null;
  let attrs: Record<string, string> = {};
  let stops: XmlElement[] = [];
  let el: XmlElement | undefined = first;
  for (let depth = 0; el && depth < MAX_HREF_DEPTH; depth += 1) {
    // Nearer elements win; the template only fills in what is missing.
    attrs = { ...el.attrs, ...attrs };
    if (stops.length === 0) stops = el.children.filter((child) => tagOf(child) === "stop");
    const link: string | undefined = (el.attrs.href ?? el.attrs["xlink:href"])?.trim();
    el = link?.startsWith("#") ? ids.get(link.slice(1)) : undefined;
  }
  return { tag, attrs, stops };
};

const stopProps = (stop: XmlElement, parseStyle: (style: string) => Record<string, string>) => ({
  ...stop.attrs,
  ...(stop.attrs.style ? parseStyle(stop.attrs.style) : {}),
});

/** Offsets clamped to 0..1 and never decreasing, as SVG renders them. */
const parseStops = (
  stops: XmlElement[],
  opacity: number,
  currentColor: string,
  parseStyle: (style: string) => Record<string, string>,
): Stop[] => {
  let previous = 0;
  return stops.map((stop) => {
    const p = stopProps(stop, parseStyle);
    const raw = (p.offset ?? "0").trim();
    const offset = raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
    previous = Math.max(previous, clamp01(Number.isFinite(offset) ? offset : 0));
    const rawColor = (p["stop-color"] ?? "#000000").trim();
    const base = rawColor === "currentColor" ? currentColor : (parseColor(rawColor) ?? "#000000");
    const alpha = clamp01(Number.parseFloat(p["stop-opacity"] ?? "1")) * opacity;
    return { color: withAlpha(base, Number.isFinite(alpha) ? alpha : 1), position: previous };
  });
};

/**
 * A coordinate in gradient units: a bounding-box fraction or a user-space length. A percentage is
 * of `axis` (1 for bounding-box units, else the viewport's width, height or normalized diagonal).
 */
const coordinate = (value: string | undefined, fallback: string, axis: number): number => {
  const parse = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed.endsWith("%")) {
      const percent = Number.parseFloat(trimmed);
      return Number.isFinite(percent) ? (percent / 100) * axis : null;
    }
    return parseLength(trimmed);
  };
  return (value === undefined ? null : parse(value)) ?? parse(fallback) ?? 0;
};

/** The linear part keeps angles: rotation, uniform scale, flips. */
const isSimilarity = (m: Matrix): boolean => {
  const size = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3];
  const tolerance = 1e-6 * size;
  return (
    Math.abs(m[0] * m[2] + m[1] * m[3]) <= tolerance &&
    Math.abs(m[0] * m[0] + m[1] * m[1] - m[2] * m[2] - m[3] * m[3]) <= tolerance
  );
};

const channels = (hex: string): [number, number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) : 255,
];

const hex2 = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

const mix = (a: string, b: string, t: number): string => {
  const ca = channels(a);
  const cb = channels(b);
  const c = ca.map((value, i) => value + ((cb[i] ?? value) - value) * t);
  const alpha = (c[3] ?? 255) >= 254.5 ? "" : hex2(c[3] ?? 255);
  return `#${hex2(c[0] ?? 0)}${hex2(c[1] ?? 0)}${hex2(c[2] ?? 0)}${alpha}`;
};

/** The color of a stop list at `position`, padded before the first and after the last stop. */
const colorAt = (stops: Stop[], position: number): string => {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return "#000000";
  if (position <= first.position) return first.color;
  if (position >= last.position) return last.color;
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1];
    const b = stops[i];
    if (!a || !b || position > b.position) continue;
    const span = b.position - a.position;
    return span < EPSILON ? b.color : mix(a.color, b.color, (position - a.position) / span);
  }
  return last.color;
};

/** Stops re-placed on 0..1, cutting (and interpolating) at the ends. */
const clipStops = (stops: Stop[]): Stop[] => {
  // Positions are kept to 3 decimals, so stops that round onto an end are that end.
  const inside = stops
    .map((stop) => ({ ...stop, position: round(stop.position) }))
    .filter((stop) => stop.position > 0 && stop.position < 1);
  return [
    { color: colorAt(stops, 0), position: 0 },
    ...inside,
    { color: colorAt(stops, 1), position: 1 },
  ];
};

/** CSS-style angle (0 up, 90 right) of the direction `from` → `to`. */
const angleOf = (from: Point, to: Point): number => {
  const degrees = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return round((degrees + 360) % 360);
};

export type GradientInput = {
  ids: Map<string, XmlElement>;
  id: string;
  /** User space (before the element's transform) to the frame's coordinates. */
  matrix: Matrix;
  /** The element's bounding box in its user space (objectBoundingBox units). */
  local: Box;
  /** The node's box in the frame's coordinates (fills are fractions of it). */
  node: Box;
  /** fill-opacity, folded into the stops. */
  opacity: number;
  /** The root viewBox size, for percentages in userSpaceOnUse gradients. */
  viewport: { width: number; height: number };
  /** The inherited `color`, for stop-color="currentColor". */
  currentColor: string;
  parseStyle: (style: string) => Record<string, string>;
  warn: (message: string) => void;
};

/**
 * The Pego fill for `url(#id)` on a shape: a linear or radial gradient, a plain color for a
 * gradient with one stop (or a zero-length vector), or null when `id` is not a gradient.
 * Approximations (spread methods, focal points, skewed radial gradients) are reported via `warn`.
 */
export const gradientFill = (input: GradientInput): GradientFill | string | null => {
  const chain = resolveChain(input.ids, input.id);
  if (!chain) return null;
  const stops = parseStops(chain.stops, input.opacity, input.currentColor, input.parseStyle);
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  if (!firstStop || !lastStop) return null;
  if (stops.length === 1) return firstStop.color;

  const { attrs } = chain;
  const bbox = attrs.gradientUnits !== "userSpaceOnUse";
  if (bbox && (input.local.width <= EPSILON || input.local.height <= EPSILON)) return null;
  const units: Matrix = bbox
    ? [input.local.width, 0, 0, input.local.height, input.local.x, input.local.y]
    : IDENTITY;
  const transform = attrs.gradientTransform
    ? parseTransform(attrs.gradientTransform).matrix
    : IDENTITY;
  // Gradient units → frame coordinates, relative to the node's box.
  const toFrame = multiply(input.matrix, multiply(units, transform));
  const toNode = multiply([1, 0, 0, 1, -input.node.x, -input.node.y], toFrame);
  const axisX = bbox ? 1 : input.viewport.width;
  const axisY = bbox ? 1 : input.viewport.height;
  const axisR = bbox ? 1 : Math.hypot(axisX, axisY) / Math.SQRT2;
  const spread = attrs.spreadMethod;
  if (spread === "reflect" || spread === "repeat") {
    input.warn(`gradient "${input.id}": spreadMethod ${spread} is drawn as pad`);
  }
  const { width, height } = input.node;
  if (width <= EPSILON || height <= EPSILON) return lastStop.color;

  if (chain.tag === "lineargradient") {
    const from = { x: coordinate(attrs.x1, "0%", axisX), y: coordinate(attrs.y1, "0%", axisY) };
    const to = { x: coordinate(attrs.x2, "100%", axisX), y: coordinate(attrs.y2, "0%", axisY) };
    const p1 = apply(toNode, from);
    const p2 = apply(toNode, to);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (Math.hypot(dx, dy) < EPSILON) return lastStop.color;
    const angle = angleOf(p1, p2);
    // A non-uniform mapping (a bounding box that is not square) skews SVG's stripes; CSS stripes
    // stay perpendicular, so only horizontal or vertical vectors stay exact there.
    const straight =
      Math.abs(toFrame[1]) < 1e-9 &&
      Math.abs(toFrame[2]) < 1e-9 &&
      (Math.abs(to.x - from.x) < EPSILON || Math.abs(to.y - from.y) < EPSILON);
    if (!isSimilarity(toFrame) && !straight) {
      input.warn(
        `gradient "${input.id}": a diagonal gradient on a non-square shape is approximate`,
      );
    }
    // Where the SVG vector's ends fall on the CSS gradient line Pego draws for this angle.
    const { start, end } = linearGradientPoints(angle, width, height);
    const lx = end.x - start.x;
    const ly = end.y - start.y;
    const length2 = lx * lx + ly * ly;
    const along = (p: Point) => ((p.x - start.x) * lx + (p.y - start.y) * ly) / length2;
    const t1 = along(p1);
    const t2 = along(p2);
    const placed = stops.map((stop) => ({
      color: stop.color,
      position: t1 + stop.position * (t2 - t1),
    }));
    return { type: "linear", angle, stops: clipStops(placed) };
  }

  const cx = coordinate(attrs.cx, "50%", axisX);
  const cy = coordinate(attrs.cy, "50%", axisY);
  const r = coordinate(attrs.r, "50%", axisR);
  if (r <= EPSILON) return lastStop.color;
  const fx = attrs.fx === undefined ? cx : coordinate(attrs.fx, "50%", axisX);
  const fy = attrs.fy === undefined ? cy : coordinate(attrs.fy, "50%", axisY);
  if (Math.abs(fx - cx) > EPSILON || Math.abs(fy - cy) > EPSILON) {
    input.warn(`gradient "${input.id}": the radial focal point is not supported, centered it`);
  }
  const center = apply(toNode, { x: cx, y: cy });
  // Radii along the transformed axes; a rotated or skewed ellipse keeps only their lengths.
  const ex = { x: toNode[0] * r, y: toNode[1] * r };
  const ey = { x: toNode[2] * r, y: toNode[3] * r };
  if (Math.abs(ex.y) > 1e-6 || Math.abs(ey.x) > 1e-6) {
    input.warn(`gradient "${input.id}": a rotated or skewed radial gradient was straightened`);
  }
  return {
    type: "radial",
    center: [round(center.x / width), round(center.y / height)],
    radius: [round(Math.hypot(ex.x, ex.y) / width), round(Math.hypot(ey.x, ey.y) / height)],
    stops: stops.map((stop) => ({ ...stop, position: round(stop.position) })),
  };
};

/** The element is a gradient that `gradientFill` can turn into a fill. */
export const isGradient = (ids: Map<string, XmlElement>, id: string): boolean => {
  const el = ids.get(id);
  if (!el) return false;
  const tag = tagOf(el);
  return tag === "lineargradient" || tag === "radialgradient";
};
