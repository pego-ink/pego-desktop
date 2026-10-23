/**
 * Auto-layout reconstruction for DOM imports. Per container, bottom-up: decide whether its
 * children can be a Pego horizontal/vertical stack (gap, padding, justify, align, fill/hug
 * sizing) that reproduces their measured boxes, then prove it with Pego's own `computeLayout`.
 * A container whose stack would move any child falls back to `layout: "none"` with absolute
 * x/y. Pure and total: odd geometry only ever means "absolute".
 */
import { computeLayout, type PegoDocument, type TextMeasurer } from "@pego/doc";
import type { DomBox, DomStyle } from "../browser-types";
import type { RawNode } from "./svg";

export type Sizing = number | "fill_container" | undefined;

/** Flex-item and flow facts of a child (merged over collapsed wrappers). */
export type ItemFacts = {
  /** Absolutely/fixed/sticky positioned, floated or transformed: never in a stack. */
  outOfFlow: boolean;
  flexGrow: number;
  alignSelf?: string;
  /** [top, right, bottom, left] margins. */
  margin?: [number, number, number, number];
};

export type TextInfo = {
  multiLine: boolean;
  /** white-space nowrap/pre: the text never wraps, so it gets no width. */
  noWrap: boolean;
  align: "left" | "center" | "right";
  fontSize: number;
  /** Line height in px. */
  lineHeight: number;
};

/** A converted child waiting for its parent to place and size it. */
export type Item = {
  /** The node without x/y/width/height (the parent sets them). */
  raw: RawNode;
  /** Where the node must end up, in page coordinates. */
  box: DomBox;
  kind: "frame" | "text" | "image" | "vector";
  /** A frame whose own children are auto-laid-out. */
  auto: boolean;
  /**
   * What Pego gives a frame sized fit_content (its children's extent for `layout: "none"`, 0
   * for an empty frame); `heightAtWidth` is the hug height at its DOM width.
   */
  hug?: Hug;
  facts: ItemFacts;
  text?: TextInfo;
};

export type Hug = { width: number; height: number; heightAtWidth: number };

export type ContainerResult = {
  /** layout, gap, padding, justifyContent, alignItems. */
  props: RawNode;
  children: RawNode[];
  auto: boolean;
  hug?: Hug;
};

type Axis = "horizontal" | "vertical";
type Align = "start" | "center" | "end";
type Justify = "start" | "center" | "end" | "space_between" | "space_around";
type Pad = [number, number, number, number];
type Side = 0 | 1 | 2 | 3;

const round = (value: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Verification tolerance for a container side: ~2 px, up to 1.5% of it, never above 6 px. */
const tolerance = (size: number): number => Math.min(6, Math.max(2, size * 0.015));
/** Classification tolerance (which edge a child hugs, uniform gaps). */
const SNAP = 1.5;
/** A hug size within this of the DOM size counts as hugging. */
const HUG = 1;

// --- geometry per axis -----------------------------------------------------------

type Geo = {
  ms: "x" | "y";
  ml: "width" | "height";
  cs: "x" | "y";
  cl: "width" | "height";
  /** Indexes into [top, right, bottom, left]. */
  padMS: Side;
  padME: Side;
  padCS: Side;
  padCE: Side;
};

const GEO: Record<Axis, Geo> = {
  horizontal: {
    ms: "x",
    ml: "width",
    cs: "y",
    cl: "height",
    padMS: 3,
    padME: 1,
    padCS: 0,
    padCE: 2,
  },
  vertical: { ms: "y", ml: "height", cs: "x", cl: "width", padMS: 0, padME: 2, padCS: 3, padCE: 1 },
};

const start = (b: DomBox, k: "x" | "y") => b[k];
const end = (b: DomBox, k: "x" | "y") => b[k] + (k === "x" ? b.width : b.height);

/** Items sorted along the axis, or null when they do not follow each other without overlap. */
const sequence = (items: Item[], axis: Axis): Item[] | null => {
  const g = GEO[axis];
  const sorted = [...items].sort((a, b) => start(a.box, g.ms) - start(b.box, g.ms));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) return null;
    if (start(cur.box, g.ms) < end(prev.box, g.ms) - 1) return null;
  }
  return sorted;
};

// --- css mapping -----------------------------------------------------------------

/** CSS justify-content -> Pego, for items sorted by position (reverse flips flex-start/end). */
const mapJustify = (value: string | undefined, reverse: boolean): Justify | null => {
  const v = (value ?? "normal")
    .trim()
    .toLowerCase()
    .replace(/^(safe|unsafe)\s+/, "");
  const flip = (j: "start" | "end"): Justify => (reverse ? (j === "start" ? "end" : "start") : j);
  switch (v) {
    case "normal":
    case "stretch":
    case "flex-start":
      return flip("start");
    case "flex-end":
      return flip("end");
    case "start":
    case "left":
      return "start";
    case "end":
    case "right":
      return "end";
    case "center":
      return "center";
    case "space-between":
      return "space_between";
    case "space-around":
      return "space_around";
    default:
      return null; // space-evenly and friends: use the observed spacing instead
  }
};

const mapAlign = (value: string | undefined): Align | null => {
  const v = (value ?? "normal")
    .trim()
    .toLowerCase()
    .replace(/^(safe|unsafe)\s+/, "");
  if (v === "center") return "center";
  if (v === "flex-end" || v === "end" || v === "self-end") return "end";
  if (v === "flex-start" || v === "start" || v === "self-start" || v.includes("baseline"))
    return "start";
  if (v === "normal" || v === "stretch") return "start";
  return null;
};

const isStretch = (value: string | undefined): boolean => {
  const v = (value ?? "normal").trim().toLowerCase();
  return v === "normal" || v === "stretch";
};

// --- verification with Pego's layout ---------------------------------------------

type Plan = {
  axis: Axis;
  items: Item[];
  sizes: { width: Sizing; height: Sizing }[];
  pad: Pad;
  gap: number;
  justify: Justify;
  align: Align;
};

const tmpDoc = (root: RawNode): PegoDocument =>
  ({
    version: 7,
    id: "tmp",
    name: "tmp",
    variables: {},
    children: [{ type: "page", id: "__page", name: "p", x: 0, y: 0, children: [root] }],
  }) as unknown as PegoDocument;

/**
 * Text measures as its DOM box. Unconstrained, wrapping text runs on one line (as the editor
 * measures it); narrower than its box it wraps onto proportionally more lines.
 */
const measurerFor =
  (items: Map<string, Item>): TextMeasurer =>
  (node, maxWidth) => {
    const item = items.get(node.id);
    if (!item) return { width: 0, height: 0 };
    const { width, height } = item.box;
    if (maxWidth === undefined) {
      if (!item.text || !wraps(item)) return { width, height };
      const lines = Math.max(1, Math.round(height / Math.max(1, item.text.lineHeight)));
      return { width: width * lines, height: height / lines };
    }
    if (maxWidth >= width - 1) return { width, height };
    return { width: maxWidth, height: height * Math.ceil(width / Math.max(1, maxWidth)) };
  };

/** A stand-in for a child: text stays text (measured), others are a box hugging their size. */
const proxy = (item: Item, id: string, size: { width: Sizing; height: Sizing }): RawNode => {
  const sized = {
    ...(size.width !== undefined ? { width: size.width } : {}),
    ...(size.height !== undefined ? { height: size.height } : {}),
  };
  if (item.kind === "text") return { type: "text", id, content: "", ...sized };
  const hug = item.hug ?? {
    width: item.box.width,
    height: item.box.height,
    heightAtWidth: item.box.height,
  };
  const hugW = hug.width;
  const hugH = size.width === undefined ? hug.height : hug.heightAtWidth;
  return {
    type: "frame",
    id,
    layout: "none",
    ...sized,
    children: [{ type: "rectangle", id: `${id}:hug`, x: 0, y: 0, width: hugW, height: hugH }],
  };
};

const planNode = (plan: Plan, own: { width?: number; height?: number }): RawNode => ({
  type: "frame",
  id: "__c",
  layout: plan.axis,
  ...own,
  padding: plan.pad,
  gap: plan.gap,
  justifyContent: plan.justify,
  alignItems: plan.align,
  children: plan.items.map((item, i) => proxy(item, `i${i}`, plan.sizes[i] ?? sizeNone)),
});

const sizeNone = { width: undefined, height: undefined };

const runLayout = (plan: Plan, own: { width?: number; height?: number }) => {
  const byId = new Map(plan.items.map((item, i) => [`i${i}`, item] as const));
  try {
    return computeLayout(tmpDoc(planNode(plan, own)), measurerFor(byId));
  } catch {
    return null;
  }
};

/** Does Pego place every child where the page had it (within tolerance)? */
const verify = (plan: Plan, box: DomBox): boolean => {
  const layout = runLayout(plan, { width: box.width, height: box.height });
  const root = layout?.get("__c");
  if (!layout || !root) return false;
  const tx = tolerance(box.width);
  const ty = tolerance(box.height);
  return plan.items.every((item, i) => {
    const got = layout.get(`i${i}`);
    if (!got) return false;
    const x = got.x - root.x;
    const y = got.y - root.y;
    const ex = item.box.x - box.x;
    const ey = item.box.y - box.y;
    if (Math.abs(y - ey) > ty || Math.abs(got.height - item.box.height) > ty) return false;
    if (Math.abs(got.width - item.box.width) <= tx) return Math.abs(x - ex) <= tx;
    // Only text may be wider than its DOM box (a fill/fixed width around ragged lines): it must
    // not be narrower, and its aligned edge (or center) must land where the page had it.
    if (item.kind !== "text" || got.width < item.box.width - tx) return false;
    const align = item.text?.align ?? "left";
    if (align === "center") return Math.abs(x + got.width / 2 - (ex + item.box.width / 2)) <= tx;
    if (align === "right") return Math.abs(x + got.width - (ex + item.box.width)) <= tx;
    return Math.abs(x - ex) <= tx;
  });
};

const hugOf = (plan: Plan, box: DomBox): ContainerResult["hug"] => {
  const free = runLayout(plan, {})?.get("__c");
  const atWidth = runLayout(plan, { width: box.width })?.get("__c");
  if (!free || !atWidth) return undefined;
  return { width: free.width, height: free.height, heightAtWidth: atWidth.height };
};

// --- sizing ----------------------------------------------------------------------

/** A frame's size on one axis: hug when its content already gives the DOM size, else fixed. */
const frameSize = (item: Item, dim: "width" | "height", widthHugs: boolean): Sizing => {
  if (item.kind !== "frame" || !item.hug) return round(item.box[dim]);
  const hug =
    dim === "width" ? item.hug.width : widthHugs ? item.hug.height : item.hug.heightAtWidth;
  return Math.abs(hug - item.box[dim]) <= HUG ? undefined : round(item.box[dim]);
};

const wraps = (item: Item): boolean => !!item.text?.multiLine && !item.text.noWrap;

/** Size of a child of a `layout: "none"` frame. */
const absoluteSize = (item: Item): { width: Sizing; height: Sizing } => {
  if (item.kind === "text")
    return { width: wraps(item) ? Math.ceil(item.box.width) : undefined, height: undefined };
  if (item.kind !== "frame")
    return { width: round(item.box.width), height: round(item.box.height) };
  const width = frameSize(item, "width", false);
  return { width, height: frameSize(item, "height", width === undefined) };
};

const POSITIONAL = new Set(["x", "y", "width", "height", "type", "name"]);

/** The node with the position/size its parent decided (x/y omitted inside a stack). */
export const placeRaw = (
  raw: RawNode,
  pos: { x: number; y: number } | null,
  size: { width: Sizing; height: Sizing },
): RawNode => {
  const { type, name } = raw;
  const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => !POSITIONAL.has(key)));
  return {
    type,
    ...(name !== undefined ? { name } : {}),
    ...(pos ? { x: round(pos.x), y: round(pos.y) } : {}),
    ...(size.width !== undefined ? { width: size.width } : {}),
    ...(size.height !== undefined ? { height: size.height } : {}),
    ...rest,
  };
};

/** Children of a `layout: "none"` container: DOM order, positions relative to the container. */
export const placeAbsolute = (box: DomBox, items: Item[]): RawNode[] =>
  items.map((item) =>
    placeRaw(item.raw, { x: item.box.x - box.x, y: item.box.y - box.y }, absoluteSize(item)),
  );

/** Size of the converted root / standalone frame: hug only when it reproduces the DOM size. */
export const rootHeight = (item: Item): number | undefined =>
  item.hug && Math.abs(item.hug.heightAtWidth - item.box.height) <= HUG
    ? undefined
    : round(item.box.height);

// --- planning --------------------------------------------------------------------

type Candidate = { pad: Pad; gap: number; justify: Justify; useFill: boolean };

type Context = {
  box: DomBox;
  style: DomStyle;
  flex: boolean;
  axis: Axis;
  items: Item[];
};

const cssPadding = (style: DomStyle): Pad => {
  const pad = Array.isArray(style.padding) && style.padding.length === 4 ? style.padding : [];
  const border =
    Array.isArray(style.borderWidth) && style.borderWidth.length === 4 ? style.borderWidth : [];
  return [0, 1, 2, 3].map((i) => {
    const p = pad[i];
    const b = border[i];
    return Math.max(0, isNum(p) ? p : 0) + Math.max(0, isNum(b) ? b : 0);
  }) as Pad;
};

/** Gaps between consecutive items; their mean when uniform (within SNAP), else null. */
const uniformGap = (items: Item[], axis: Axis): number | null => {
  const g = GEO[axis];
  const gaps: number[] = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev && cur) gaps.push(start(cur.box, g.ms) - end(prev.box, g.ms));
  }
  if (gaps.length === 0) return 0;
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  if (max - min > 2 * SNAP) return null;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.max(0, mean);
};

const growsMain = (ctx: Context, item: Item): boolean =>
  ctx.flex && item.facts.flexGrow > 0 && item.kind !== "image" && item.kind !== "vector";

/**
 * Can this frame fill the cross axis? In a vertical stack a child spanning the content width
 * does (block boxes fill their line); in a row only a stretched flex item does.
 */
const mayStretch = (ctx: Context, item: Item): boolean => {
  if (item.kind !== "frame") return false;
  if (ctx.axis === "vertical") return true;
  if (!ctx.flex) return false;
  const self = item.facts.alignSelf?.trim().toLowerCase();
  return self && self !== "auto" ? isStretch(self) : isStretch(ctx.style.alignItems);
};

/** Does a wrapping paragraph fill the stack's width (its lines were wrapped by that width)? */
const textSpans = (item: Item, is: number, ie: number, tol: number): boolean => {
  const width = ie - is;
  const w = item.box.width;
  const fontSize = item.text?.fontSize ?? 16;
  const slack = Math.min(Math.max(4 * fontSize, 8), 0.25 * width);
  if (w > width + tol || width - w > slack + tol) return false;
  return anchorMatches(item, is, ie, tol);
};

const anchorMatches = (item: Item, is: number, ie: number, tol: number): boolean => {
  const s = item.box.x;
  const e = item.box.x + item.box.width;
  switch (item.text?.align ?? "left") {
    case "center":
      return Math.abs((s + e) / 2 - (is + ie) / 2) <= tol;
    case "right":
      return Math.abs(e - ie) <= tol;
    default:
      return Math.abs(s - is) <= tol;
  }
};

type CrossRole = "fill" | "flexible" | "rigid";

const ALIGNS: Align[] = ["start", "center", "end"];

/** Resolve cross-axis alignment and every child's sizing for one candidate, or null. */
const resolvePlan = (ctx: Context, cand: Candidate, shifted = false): Plan | null => {
  const g = GEO[ctx.axis];
  const { box } = ctx;
  const is = box[g.cs] + cand.pad[g.padCS];
  const ie = box[g.cs] + box[g.cl] - cand.pad[g.padCE];
  if (ie - is < 0) return null;
  const tol = SNAP;

  const roles: CrossRole[] = [];
  const accepts: Set<Align>[] = [];
  for (const item of ctx.items) {
    const cs = start(item.box, g.cs);
    const ce = end(item.box, g.cs);
    const off0 = cs - is;
    const off1 = ie - ce;
    const geo = new Set<Align>();
    if (Math.abs(off0) <= tol) geo.add("start");
    if (Math.abs(off1) <= tol) geo.add("end");
    if (Math.abs(off0 - off1) <= 2 * tol) geo.add("center");
    accepts.push(geo);
    const spans = Math.abs(off0) <= tol && Math.abs(off1) <= tol;
    if (item.kind === "text" && ctx.axis === "vertical") {
      if (wraps(item) && textSpans(item, is, ie, tol)) roles.push("fill");
      else if (!wraps(item) && item.text?.align !== "left" && anchorMatches(item, is, ie, tol))
        roles.push("flexible");
      else roles.push("rigid");
    } else if (spans && mayStretch(ctx, item)) roles.push("fill");
    else roles.push("rigid");
  }

  let options = new Set<Align>(ALIGNS);
  ctx.items.forEach((_, i) => {
    if (roles[i] !== "rigid") return;
    const geo = accepts[i] ?? new Set<Align>();
    options = new Set([...options].filter((a) => geo.has(a)));
  });
  const preferred = ctx.flex ? mapAlign(ctx.style.alignItems) : null;
  const align: Align | undefined =
    preferred && options.has(preferred) ? preferred : ALIGNS.find((a) => options.has(a));

  if (!align) {
    // Every rigid child sits at the same offset (e.g. uniform cross margins): fold it into padding.
    if (shifted || roles.some((r) => r === "fill")) return null;
    const offsets = ctx.items.map((item) => start(item.box, g.cs) - is);
    const min = Math.min(...offsets);
    const max = Math.max(...offsets);
    if (min <= 0 || max - min > 2 * tol) return null;
    const pad = [...cand.pad] as Pad;
    pad[g.padCS] += (min + max) / 2;
    return resolvePlan(ctx, { ...cand, pad }, true);
  }

  const sizes = ctx.items.map((item, i) => {
    const role = roles[i];
    const fillMain = cand.useFill && growsMain(ctx, item);
    const fillCross =
      role === "fill" || (role === "flexible" && !(accepts[i] ?? new Set()).has(align));
    if (item.kind === "text") {
      const width: Sizing =
        ctx.axis === "vertical"
          ? fillCross
            ? "fill_container"
            : wraps(item)
              ? Math.ceil(item.box.width)
              : undefined
          : wraps(item)
            ? fillMain
              ? "fill_container"
              : Math.ceil(item.box.width)
            : undefined;
      return { width, height: undefined };
    }
    if (item.kind !== "frame")
      return { width: round(item.box.width), height: round(item.box.height) };
    const fillW = ctx.axis === "horizontal" ? fillMain : fillCross;
    const fillH = ctx.axis === "vertical" ? fillMain : fillCross;
    const width: Sizing = fillW ? "fill_container" : frameSize(item, "width", false);
    const height: Sizing = fillH
      ? "fill_container"
      : frameSize(item, "height", width === undefined);
    return { width, height };
  });

  return {
    axis: ctx.axis,
    items: ctx.items,
    sizes,
    pad: cand.pad,
    gap: cand.gap,
    justify: cand.justify,
    align,
  };
};

const candidatesFor = (ctx: Context, reverse: boolean): Candidate[] => {
  const g = GEO[ctx.axis];
  const { box, style, items } = ctx;
  const css = cssPadding(style);
  const observedGap = uniformGap(items, ctx.axis);
  const out: Omit<Candidate, "useFill">[] = [];

  if (ctx.flex) {
    const justify = mapJustify(style.justifyContent, reverse);
    const cssGap =
      ctx.axis === "horizontal" ? (style.columnGap ?? style.gap) : (style.rowGap ?? style.gap);
    if (justify) out.push({ pad: css, gap: isNum(cssGap) ? Math.max(0, cssGap) : 0, justify });
  }
  if (observedGap !== null) {
    // Observed main-axis padding first: margins of the first/last child fold into the padding
    // (so the container can still hug), then the plain CSS padding.
    const first = items[0];
    const last = items[items.length - 1];
    if (first && last) {
      const leading = start(first.box, g.ms) - box[g.ms];
      const trailing = box[g.ms] + box[g.ml] - end(last.box, g.ms);
      const lastMargin = last.facts.margin?.[g.padME];
      const endPad = Math.min(
        trailing,
        css[g.padME] + (isNum(lastMargin) ? Math.max(0, lastMargin) : 0),
      );
      if (leading >= -SNAP && trailing >= -SNAP) {
        const pad = [...css] as Pad;
        pad[g.padMS] = Math.max(0, leading);
        pad[g.padME] = Math.max(0, endPad);
        out.push({ pad, gap: observedGap, justify: "start" });
      }
    }
    out.push({ pad: css, gap: observedGap, justify: "start" });
  }
  const anyGrow = items.some((item) => growsMain(ctx, item));
  const all = [
    ...out.map((c) => ({ ...c, useFill: anyGrow })),
    ...(anyGrow ? out.map((c) => ({ ...c, useFill: false })) : []),
  ];
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = JSON.stringify([c.pad.map((p) => round(p)), round(c.gap), c.justify, c.useFill]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sides = (pad: Pad): number | number[] | undefined => {
  const r = pad.map((p) => round(p));
  if (r.every((p) => p === 0)) return undefined;
  return r.every((p) => p === r[0]) ? r[0] : r;
};

const resultOf = (plan: Plan, box: DomBox): ContainerResult => {
  const padding = sides(plan.pad);
  const gap = round(plan.gap);
  return {
    props: {
      layout: plan.axis,
      ...(gap !== 0 ? { gap } : {}),
      ...(padding !== undefined ? { padding } : {}),
      ...(plan.justify !== "start" ? { justifyContent: plan.justify } : {}),
      ...(plan.align !== "start" ? { alignItems: plan.align } : {}),
    },
    children: plan.items.map((item, i) => placeRaw(item.raw, null, plan.sizes[i] ?? sizeNone)),
    auto: true,
    hug: hugOf(plan, box),
  };
};

const flexAxis = (style: DomStyle): { axis: Axis; reverse: boolean } => {
  const dir = (style.flexDirection ?? "row").trim().toLowerCase();
  return {
    axis: dir.startsWith("column") ? "vertical" : "horizontal",
    reverse: dir.endsWith("-reverse"),
  };
};

/**
 * Lay out one container's converted children: a verified horizontal/vertical stack when the
 * page's layout can be expressed that way, else `layout: "none"` with absolute positions.
 */
export const layoutContainer = (box: DomBox, style: DomStyle, items: Item[]): ContainerResult => {
  const absolute = (): ContainerResult => {
    // A `layout: "none"` frame hugs the extent of its children (they keep their x/y).
    const width = Math.max(0, ...items.map((item) => item.box.x + item.box.width - box.x));
    const height = Math.max(0, ...items.map((item) => item.box.y + item.box.height - box.y));
    return {
      props: { layout: "none" },
      children: placeAbsolute(box, items),
      auto: false,
      hug: { width, height, heightAtWidth: height },
    };
  };
  if (items.length === 0) return absolute();
  if (items.some((item) => item.facts.outOfFlow)) return absolute();

  const flex = /flex/.test((style.display ?? "").toLowerCase());
  const options: { axis: Axis; reverse: boolean }[] = flex
    ? [flexAxis(style)]
    : [
        { axis: "vertical", reverse: false },
        { axis: "horizontal", reverse: false },
      ];
  for (const { axis, reverse } of options) {
    const sorted = sequence(items, axis);
    if (!sorted) continue;
    const ctx: Context = { box, style, flex, axis, items: sorted };
    for (const cand of candidatesFor(ctx, reverse)) {
      const plan = resolvePlan(ctx, cand);
      if (plan && verify(plan, box)) return resultOf(plan, box);
    }
  }
  return absolute();
};
