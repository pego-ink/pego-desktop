import { resolveInstance } from "./instance";
import { resolveNumber, resolveSides, type Sides } from "./resolve";
import type { FrameNode, PegoDocument, PegoNode, TextNode, Variables } from "./schema";
import { isContainer } from "./tree";

/** Axis-aligned box in absolute document coordinates, before the node's own rotation. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * Measures a text node. `maxWidth` is set when the text wraps inside a known width (numeric
 * width or a width given by `fill_container`); the renderer must wrap under the same rule.
 */
export type TextMeasurer = (
  node: TextNode,
  maxWidth: number | undefined,
  variables: Variables,
) => { width: number; height: number };

/** Box per node id, including expanded instance descendants (`<instanceId>/<sourceId>`). */
export type Layout = Map<string, Box>;

/** Refs nested deeper than this are not expanded (guards against self-referencing components). */
export const MAX_INSTANCE_DEPTH = 16;

/** Visit a node and its rendered children, expanding refs. `node` is the expanded form. */
export const walkRendered = (
  doc: PegoDocument,
  nodes: readonly PegoNode[],
  visit: (node: PegoNode, depth: number) => boolean | void,
  depth = 0,
): void => {
  for (const raw of nodes) {
    const node = raw.type === "ref" && depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, raw) : raw;
    if (!node) continue;
    if (visit(node, depth) === false) continue;
    if (isContainer(node)) walkRendered(doc, node.children, visit, depth + 1);
  }
};

/** The expanded (refs resolved) node with this id, including instance descendants. */
export const findRenderedNode = (doc: PegoDocument, id: string): PegoNode | null => {
  let found: PegoNode | null = null;
  walkRendered(doc, doc.children, (node) => {
    if (found) return false;
    if (node.id !== id) return;
    found = node;
    return false;
  });
  return found;
};

/**
 * Whether `parent`'s flex layout places `child`: true for a child of a horizontal or vertical
 * frame, unless the child opts out with `layoutPosition: "absolute"` (it keeps its own x/y).
 */
export const placedByLayout = (parent: PegoNode | null | undefined, child: PegoNode): boolean =>
  parent?.type === "frame" && parent.layout !== "none" && !isAbsolute(child);

/** The node opts out of a flex parent's flow (`layoutPosition: "absolute"`; pages never do). */
export const isAbsolute = (node: PegoNode): boolean =>
  node.type !== "page" && node.layoutPosition === "absolute";

type Size = { width: number; height: number };

/** A sized node with its children placed relative to its own top-left corner. */
type Sized = Size & {
  node: PegoNode;
  children: { sized: Sized; x: number; y: number }[];
};

type Axis = "width" | "height";
const crossOf = (axis: Axis): Axis => (axis === "width" ? "height" : "width");

/** `padding` as [top, right, bottom, left] (CSS order). */
const resolvePadding = (doc: PegoDocument, node: FrameNode): Sides =>
  resolveSides(node.padding, doc.variables, 0);

/**
 * Compute absolute boxes for every rendered node.
 *
 * Sizing per axis: a number is fixed; `fit_content` hugs the children (frames default to it,
 * text measures itself); `fill_container` takes the parent's remaining main-axis space or its
 * full inner cross size. A fill child inside a hugging parent behaves as hug while the parent
 * is measured, then fills the size the parent ended up with. Children of `layout: "none"`
 * frames and groups keep their own x/y; children of flex frames are placed by the frame, except
 * `layoutPosition: "absolute"` ones: they keep their own x/y, take no room and do not count
 * toward the frame's hug size, and `fill_container` gives them the frame's full size.
 */
export const computeLayout = (doc: PegoDocument, measureText: TextMeasurer): Layout => {
  // Sizing the same node with the same constraints happens repeatedly in nested flex; memoize.
  const memo = new WeakMap<PegoNode, Map<string, Sized>>();

  // Hidden nodes get no box: everything that draws, hits or exports from the layout skips them.
  const expand = (node: PegoNode, depth: number): PegoNode | null => {
    if (node.visible === false) return null;
    if (node.type !== "ref") return node;
    return depth < MAX_INSTANCE_DEPTH ? resolveInstance(doc, node) : null;
  };

  const sizeOf = (node: PegoNode, depth: number, forced: Partial<Size> = {}): Sized => {
    const key = `${forced.width ?? ""}|${forced.height ?? ""}`;
    const cached = memo.get(node)?.get(key);
    if (cached) return cached;
    const sized = computeSize(node, depth, forced);
    const byKey = memo.get(node) ?? new Map<string, Sized>();
    byKey.set(key, sized);
    memo.set(node, byKey);
    return sized;
  };

  const fixed = (node: PegoNode, axis: Axis, forced: Partial<Size>): number | undefined =>
    forced[axis] ?? (typeof node[axis] === "number" ? node[axis] : undefined);

  const computeSize = (node: PegoNode, depth: number, forced: Partial<Size>): Sized => {
    const width = fixed(node, "width", forced);
    const height = fixed(node, "height", forced);

    if (node.type === "text") {
      const measured = measureText(node, width, doc.variables);
      return {
        node,
        width: width ?? measured.width,
        height: height ?? measured.height,
        children: [],
      };
    }
    if (!isContainer(node)) {
      return { node, width: width ?? 0, height: height ?? 0, children: [] };
    }

    const children = node.children
      .map((child) => expand(child, depth + 1))
      .filter((child): child is PegoNode => child !== null);

    if (node.type === "frame" && node.layout !== "none") {
      const flow = children.filter((child) => placedByLayout(node, child));
      if (flow.length === children.length) {
        return computeFlex(node, children, depth, { width, height });
      }
      // Absolute children: placed once the frame's size is known, kept in drawing order.
      const sized = computeFlex(node, flow, depth, { width, height });
      const placedFlow = new Map(sized.children.map((placed, i) => [flow[i]!, placed]));
      return {
        ...sized,
        children: children.map(
          (child) =>
            placedFlow.get(child) ?? {
              sized: sizeOf(child, depth + 1, {
                width: child.width === "fill_container" ? sized.width : undefined,
                height: child.height === "fill_container" ? sized.height : undefined,
              }),
              x: resolveNumber(child.x, doc.variables, 0),
              y: resolveNumber(child.y, doc.variables, 0),
            },
        ),
      };
    }
    return computeAbsolute(node, children, depth, { width, height });
  };

  /** Groups and `layout: "none"` frames: children keep x/y; fit_content hugs their extent. */
  const computeAbsolute = (
    node: PegoNode,
    children: PegoNode[],
    depth: number,
    own: Partial<Size>,
  ): Sized => {
    const place = (inner: Partial<Size>) =>
      children.map((child) => ({
        sized: sizeOf(child, depth + 1, {
          width: child.width === "fill_container" ? inner.width : undefined,
          height: child.height === "fill_container" ? inner.height : undefined,
        }),
        x: resolveNumber(child.x, doc.variables, 0),
        y: resolveNumber(child.y, doc.variables, 0),
      }));

    const hugged = place(own);
    const width = own.width ?? Math.max(0, ...hugged.map((c) => c.x + c.sized.width));
    const height = own.height ?? Math.max(0, ...hugged.map((c) => c.y + c.sized.height));
    const needsRefill =
      (own.width === undefined || own.height === undefined) &&
      children.some((c) => c.width === "fill_container" || c.height === "fill_container");
    return { node, width, height, children: needsRefill ? place({ width, height }) : hugged };
  };

  const computeFlex = (
    node: FrameNode,
    children: PegoNode[],
    depth: number,
    own: Partial<Size>,
  ): Sized => {
    const main: Axis = node.layout === "horizontal" ? "width" : "height";
    const cross = crossOf(main);
    const [top, right, bottom, left] = resolvePadding(doc, node);
    const padMain = main === "width" ? left + right : top + bottom;
    const padCross = main === "width" ? top + bottom : left + right;
    const gap = resolveNumber(node.gap, doc.variables, 0);
    const gaps = gap * Math.max(0, children.length - 1);
    const fillsMain = (child: PegoNode) => child[main] === "fill_container";
    const fillsCross = (child: PegoNode) => child[cross] === "fill_container";

    const ownCross = own[cross];
    const innerCrossKnown = ownCross === undefined ? undefined : Math.max(0, ownCross - padCross);

    // Pass 1: intrinsic sizes (fill children hug for now unless the size is already known).
    const intrinsic = children.map((child) =>
      sizeOf(child, depth + 1, {
        [cross]: fillsCross(child) ? innerCrossKnown : undefined,
      }),
    );

    const ownMain = own[main];
    const mainSize = ownMain ?? intrinsic.reduce((sum, s) => sum + s[main], 0) + gaps + padMain;
    const innerMain = Math.max(0, mainSize - padMain);

    // Pass 2: distribute remaining main space to fill children (only when the frame's main size is set).
    const fillCount = children.filter(fillsMain).length;
    const fixedMain = children.reduce(
      (sum, child, i) =>
        sum + (fillsMain(child) && ownMain !== undefined ? 0 : intrinsic[i]![main]),
      0,
    );
    const fillShare =
      fillCount > 0 && ownMain !== undefined
        ? Math.max(0, (innerMain - fixedMain - gaps) / fillCount)
        : undefined;

    const withMain = children.map((child, i) =>
      fillShare !== undefined && fillsMain(child)
        ? sizeOf(child, depth + 1, {
            [main]: fillShare,
            [cross]: fillsCross(child) ? innerCrossKnown : undefined,
          })
        : intrinsic[i]!,
    );

    const crossSize = ownCross ?? Math.max(0, ...withMain.map((s) => s[cross])) + padCross;
    const innerCross = Math.max(0, crossSize - padCross);

    // Pass 3: stretch cross-fill children to the final inner cross size.
    const sized = children.map((child, i) =>
      fillsCross(child) && withMain[i]![cross] !== innerCross
        ? sizeOf(child, depth + 1, {
            // Re-forcing a hugged main size could re-wrap text on rounding; only pass real fills.
            [main]: fillShare !== undefined && fillsMain(child) ? fillShare : undefined,
            [cross]: innerCross,
          })
        : withMain[i]!,
    );

    const used = sized.reduce((sum, s) => sum + s[main], 0) + gaps;
    const free = innerMain - used;
    const count = sized.length;
    const justify = node.justifyContent ?? "start";
    const between =
      justify === "space_between" && count > 1
        ? free / (count - 1)
        : justify === "space_around" && count > 0
          ? free / count
          : 0;
    const startOffset =
      justify === "center"
        ? free / 2
        : justify === "end"
          ? free
          : justify === "space_around"
            ? between / 2
            : 0;

    const mainStart = main === "width" ? left : top;
    const crossStart = main === "width" ? top : left;
    const align = node.alignItems ?? "start";
    let cursor = mainStart + startOffset;
    const placed = sized.map((s) => {
      const crossFree = innerCross - s[cross];
      const crossOffset = align === "center" ? crossFree / 2 : align === "end" ? crossFree : 0;
      const mainPos = cursor;
      cursor += s[main] + gap + between;
      const crossPos = crossStart + crossOffset;
      return main === "width"
        ? { sized: s, x: mainPos, y: crossPos }
        : { sized: s, x: crossPos, y: mainPos };
    });

    return {
      node,
      width: main === "width" ? mainSize : crossSize,
      height: main === "width" ? crossSize : mainSize,
      children: placed,
    };
  };

  const layout: Layout = new Map();
  const record = (sized: Sized, x: number, y: number) => {
    layout.set(sized.node.id, { x, y, width: sized.width, height: sized.height });
    for (const child of sized.children) record(child.sized, x + child.x, y + child.y);
  };
  // Pages have no box: their content keeps its own x/y in canvas coordinates, page by page.
  for (const page of doc.children) {
    for (const raw of page.children) {
      const node = expand(raw, 0);
      if (!node) continue;
      record(
        sizeOf(node, 0),
        resolveNumber(node.x, doc.variables, 0),
        resolveNumber(node.y, doc.variables, 0),
      );
    }
  }
  return layout;
};
