import { placedByLayout, type Layout } from "./layout";
import type { Op } from "./ops";
import type { PegoDocument, PegoNode } from "./schema";
import { findNode } from "./tree";

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** A plain number scaled by `factor`, or the value untouched (variables, keywords). */
const scaled = <T>(value: T, factor: number, min = 0): T | number =>
  typeof value === "number" ? Math.max(min, round(value * factor)) : value;

/** A plain number position scaled by `factor` (may be negative). */
const scaledPos = <T>(value: T, factor: number): T | number =>
  typeof value === "number" ? round(value * factor) : value;

type Sides = number | string | readonly (number | string)[];

/**
 * Padding or per-side stroke width. A single value stays single while the scale is uniform;
 * with sx != sy it is split into `[top, right, bottom, left]` so each axis scales on its own.
 */
const scaleSides = (value: unknown, sx: number, sy: number, s: number): unknown => {
  const sides = value as Sides;
  if (Array.isArray(sides)) {
    const [t, r, b, l] = sides;
    return [scaled(t, sy), scaled(r, sx), scaled(b, sy), scaled(l, sx)];
  }
  if (typeof sides !== "number") return sides;
  if (sx === sy) return scaled(sides, s);
  return [scaled(sides, sy), scaled(sides, sx), scaled(sides, sy), scaled(sides, sx)];
};

const scaleStroke = (
  stroke: { width?: unknown } & Record<string, unknown>,
  sx: number,
  sy: number,
  s: number,
) => ({
  ...stroke,
  ...(stroke.width === undefined
    ? {}
    : {
        width: Array.isArray(stroke.width)
          ? scaleSides(stroke.width, sx, sy, s)
          : scaled(stroke.width, s),
      }),
});

const scaleEffect = (effect: Record<string, unknown>, sx: number, sy: number, s: number) =>
  effect.type === "shadow"
    ? {
        ...effect,
        ...(effect.x === undefined ? {} : { x: scaledPos(effect.x, sx) }),
        ...(effect.y === undefined ? {} : { y: scaledPos(effect.y, sy) }),
        ...(effect.blur === undefined ? {} : { blur: scaled(effect.blur, s) }),
        ...(effect.spread === undefined ? {} : { spread: scaledPos(effect.spread, s) }),
      }
    : { ...effect, ...(effect.radius === undefined ? {} : { radius: scaled(effect.radius, s) }) };

/** Props that change when `node` is scaled; children are handled by the caller. */
const scaleProps = (
  node: PegoNode,
  box: { width: number; height: number } | undefined,
  positioned: boolean,
  sx: number,
  sy: number,
): Record<string, unknown> => {
  const s = Math.sqrt(Math.abs(sx * sy));
  const raw = node as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    // Keep unchanged non-zero numbers: the resize gesture re-sends ops on every move, so a prop
    // that was scaled earlier must be written back when the scale returns to 1. Strings
    // (variables, keywords) and zeros never change, so they are skipped.
    if (value === undefined) return;
    if (value === raw[key] && (typeof value === "string" || value === 0)) return;
    next[key] = value;
  };

  if (positioned) {
    set("x", scaledPos(raw.x, sx));
    set("y", scaledPos(raw.y, sy));
  }

  // A path without a viewBox draws its geometry in px: pin it to the original size first.
  if (
    node.type === "path" &&
    !node.viewBox &&
    typeof node.width === "number" &&
    typeof node.height === "number"
  ) {
    set("viewBox", [0, 0, node.width, node.height]);
  }

  // A ref hugging its component has no stored size: freeze it from the laid-out box.
  const width = node.type === "ref" && raw.width === undefined ? box?.width : raw.width;
  const height = node.type === "ref" && raw.height === undefined ? box?.height : raw.height;
  set("width", scaled(width, sx, 1));
  set("height", scaled(height, sy, 1));

  if (raw.cornerRadius !== undefined) set("cornerRadius", scaled(raw.cornerRadius, s));
  if (raw.fontSize !== undefined) set("fontSize", scaled(raw.fontSize, s));
  if (raw.letterSpacing !== undefined) set("letterSpacing", scaledPos(raw.letterSpacing, s));
  if (raw.stroke) set("stroke", scaleStroke(raw.stroke as Record<string, unknown>, sx, sy, s));
  if (Array.isArray(raw.effects)) {
    set(
      "effects",
      raw.effects.map((e) => scaleEffect(e as Record<string, unknown>, sx, sy, s)),
    );
  }

  if (node.type === "frame") {
    if (node.padding !== undefined) set("padding", scaleSides(node.padding, sx, sy, s));
    if (node.gap !== undefined && node.layout !== "none") {
      set("gap", scaled(node.gap, node.layout === "horizontal" ? sx : sy));
    }
  }
  return next;
};

/**
 * `update` ops that scale everything inside `rootId` by (sx, sy), root excluded: positions and
 * sizes, plus the lengths that read as size (corner radius, stroke, shadow, blur, font size,
 * letter spacing, padding, gap). Values are absolute and computed from `doc`, so the result can
 * be recomputed from the gesture's start document on every pointer move.
 *
 * - Children placed by a flex parent keep x/y (the parent places them).
 * - `fit_content` / `fill_container` stay; a `ref` without a numeric size gets one from `layout`.
 * - Axis-less lengths scale by sqrt(|sx * sy|); shadow x/y, padding, per-side stroke and gap use
 *   their own axis. A single padding or stroke value splits into four sides when sx != sy.
 * - A path without a `viewBox` gets one from its original size so its geometry follows the box;
 *   an existing `viewBox` is never changed.
 * - Limitations: `$variable` values are left as they are (they are shared), ref `descendants`
 *   overrides are not scaled, and gradient fractions need no scaling.
 * - Sizes stay at least 1px, other lengths at least 0; results are rounded to 3 decimals.
 */
export const scaleSubtreeOps = (
  doc: PegoDocument,
  layout: Layout,
  rootId: string,
  sx: number,
  sy: number,
): Op[] => {
  const root = findNode(doc, rootId);
  if (!root || !Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return [];
  const ops: Op[] = [];

  const visit = (node: PegoNode, parent: PegoNode) => {
    const flexChild = placedByLayout(parent, node);
    const props = scaleProps(node, layout.get(node.id), !flexChild, sx, sy);
    if (Object.keys(props).length > 0) ops.push({ op: "update", id: node.id, props });
    if ("children" in node) for (const child of node.children) visit(child, node);
  };
  if ("children" in root) for (const child of root.children) visit(child, root);
  return ops;
};
