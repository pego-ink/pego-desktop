import {
  isContainer,
  resolveInstance,
  resolveNumber,
  resolveSides,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import type { Severity } from "./check-layout";

/**
 * A polish finding (the ui-polish skill's rules). `key` names the rule and the source nodes, so
 * the same defect in a component and its instances is reported once.
 */
export type PolishIssue = {
  key: string;
  severity: Severity;
  node: PegoNode;
  issue: string;
  hint: string;
  /** Set when `node` is a component instance root: the component to fix instead. */
  component?: string;
};

/** Largest even inset at which nested corners should be concentric. */
const MAX_CONCENTRIC_INSET = 24;
/** A child rounder than its parent is a clear defect only this close to the corner. */
const MAX_TIGHT_INSET = 12;
/** Lucide strokes are 2 on a 24 grid, so an icon under 16px draws under 1.33px. */
const MIN_ICON_BESIDE_BOLD = 16;
const BOLD = 600;
const EDGE = 0.5;

const px = (value: number): string => `${Math.round(value * 10) / 10}`;

const label = (node: PegoNode): string => node.name ?? `${node.type} ${node.id}`;

/** The source part of a render id: instance children are `<instanceId>/<sourceId>`. */
export const sourceId = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

/** `{ component }` when `node` is an instance root (its source is a component, not itself). */
const instanceOf = (node: PegoNode, source: string): { component?: string } =>
  source !== sourceId(node.id) ? { component: source } : {};

type Item = { node: PegoNode; box: Box; source: string };

/** A frame's children as laid out: refs resolved, hidden and zero-size nodes left out. */
const visibleChildren = (doc: PegoDocument, layout: Layout, node: PegoNode): Item[] => {
  if (!isContainer(node)) return [];
  const items: Item[] = [];
  for (const raw of node.children) {
    const resolved = raw.type === "ref" ? resolveInstance(doc, raw) : raw;
    const box = resolved ? layout.get(resolved.id) : undefined;
    if (!resolved || !box || box.width <= 0 || box.height <= 0) continue;
    items.push({ node: resolved, box, source: raw.type === "ref" ? raw.ref : sourceId(raw.id) });
  }
  return items;
};

/** Corner radius as drawn: never more than half the shorter side (999 makes a pill). */
const radiusOf = (node: PegoNode, box: Box, doc: PegoDocument): number => {
  if (!("cornerRadius" in node)) return 0;
  const radius = resolveNumber(node.cornerRadius, doc.variables, 0);
  return Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
};

/** Width of a stroke drawn on every side; per-side strokes are dividers and count as 0. */
const uniformStroke = (node: PegoNode, doc: PegoDocument): number => {
  if (!("stroke" in node) || !node.stroke || Array.isArray(node.stroke.width)) return 0;
  return resolveNumber(node.stroke.width as number | string | undefined, doc.variables, 1);
};

const near = (a: number, b: number): boolean => Math.abs(a - b) <= EDGE;

const cornerIssues = (
  doc: PegoDocument,
  layout: Layout,
  node: PegoNode,
  source: string,
  box: Box,
): PolishIssue[] => {
  if (node.type !== "frame" || (node.layout !== "horizontal" && node.layout !== "vertical")) {
    return [];
  }
  const outer = radiusOf(node, box, doc);
  if (outer <= 0) return [];
  const [top, right, bottom, left] = resolveSides(node.padding, doc.variables, 0);
  const stroke = uniformStroke(node, doc);
  const issues: PolishIssue[] = [];
  for (const child of visibleChildren(doc, layout, node)) {
    const inner = radiusOf(child.node, child.box, doc);
    if (inner <= 0) continue;
    const atTop = near(child.box.y, box.y + top);
    const atBottom = near(child.box.y + child.box.height, box.y + box.height - bottom);
    const atLeft = near(child.box.x, box.x + left);
    const atRight = near(child.box.x + child.box.width, box.x + box.width - right);
    const corner = (
      [
        [atTop && atLeft, top, left],
        [atTop && atRight, top, right],
        [atBottom && atLeft, bottom, left],
        [atBottom && atRight, bottom, right],
      ] as const
    ).find(([touches, a, b]) => touches && near(a, b) && a <= MAX_CONCENTRIC_INSET);
    if (!corner) continue;
    const inset = corner[1];
    const expected = inner + inset + stroke;
    const sum = `child radius + inset${stroke > 0 ? " + stroke" : ""}`;
    const key = `corner:${source}:${child.source}`;
    if (inner > outer + EDGE) {
      issues.push({
        key,
        severity: inset <= MAX_TIGHT_INSET ? "warning" : "info",
        node,
        issue: `corner of "${label(child.node)}" (radius ${px(inner)}) is rounder than its parent's (radius ${px(outer)})`,
        hint: `Concentric corners: give "${label(node)}" cornerRadius ${px(expected)} (${sum}), or lower the child's radius.`,
        ...instanceOf(node, source),
      });
    } else if (Math.abs(outer - expected) > 2) {
      issues.push({
        key,
        severity: "info",
        node,
        issue: `corner radius ${px(outer)} is not concentric with "${label(child.node)}" (radius ${px(inner)}, inset ${px(inset)})`,
        hint: `Concentric corners: parent radius = ${sum} = ${px(expected)}. Use it or the closest radius token.`,
        ...instanceOf(node, source),
      });
    }
  }
  return issues;
};

const weightOf = (item: Item | undefined, doc: PegoDocument): number =>
  item?.node.type === "text" ? resolveNumber(item.node.fontWeight, doc.variables, 400) : 0;

const iconIssues = (doc: PegoDocument, layout: Layout, node: PegoNode): PolishIssue[] => {
  if (node.type !== "frame" || (node.layout !== "horizontal" && node.layout !== "vertical")) {
    return [];
  }
  const items = visibleChildren(doc, layout, node);
  const issues: PolishIssue[] = [];
  items.forEach((item, i) => {
    if (item.node.type !== "icon" || item.box.width >= MIN_ICON_BESIDE_BOLD) return;
    const weight = Math.max(weightOf(items[i - 1], doc), weightOf(items[i + 1], doc));
    if (weight < BOLD) return;
    const size = item.box.width;
    issues.push({
      key: `icon:${item.source}`,
      severity: "warning",
      node: item.node,
      issue: `icon is ${px(size)}px beside weight ${weight} text; its stroke is size / 12 (${px(size / 12)}px), thinner than the text`,
      hint: "Make the icon 16px or larger (18 to 20 beside 14 to 16px text), or use weight 500 for the text.",
      ...instanceOf(item.node, item.source),
    });
  });
  return issues;
};

/** A painted frame that is not stretched: a card that can end at its own height. */
const isLooseCard = (node: PegoNode): boolean =>
  node.type === "frame" &&
  (node.fill !== undefined || node.stroke !== undefined) &&
  node.height !== "fill_container";

/** Fill, stroke and radius together: cards of one row share them; an avatar and a bubble do not. */
const surfaceOf = (node: PegoNode): string =>
  node.type === "frame" ? JSON.stringify([node.fill, node.stroke, node.cornerRadius]) : "";

const rowIssues = (
  doc: PegoDocument,
  layout: Layout,
  node: PegoNode,
  source: string,
): PolishIssue[] => {
  if (node.type !== "frame" || node.layout !== "horizontal") return [];
  if (node.alignItems !== undefined && node.alignItems !== "start") return [];
  const items = visibleChildren(doc, layout, node);
  if (items.length < 2 || !items.every((item) => isLooseCard(item.node))) return [];
  if (new Set(items.map((item) => surfaceOf(item.node))).size > 1) return [];
  const heights = items.map((item) => item.box.height);
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  if (high - low <= 2) return [];
  return [
    {
      key: `row:${source}`,
      severity: "warning",
      node,
      issue: `cards in "${label(node)}" end at different heights (${px(low)} to ${px(high)}px)`,
      hint: "Set height fill_container on each card: the row hugs the tallest card and stretches the others to it.",
      ...instanceOf(node, source),
    },
  ];
};

const lopsided = (a: number, b: number): boolean => {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return low > 0 && high >= 2 * low && high - low >= 8;
};

const isPainted = (node: PegoNode): boolean =>
  node.type === "image" ||
  ("fill" in node && node.fill !== undefined) ||
  ("stroke" in node && node.stroke !== undefined);

type Side = "top" | "right" | "bottom" | "left";

/** True when a child box sits on the frame's inner edge at `side` (the padding line). */
const onInnerEdge = (child: Box, box: Box, side: Side, inset: number): boolean => {
  if (side === "top") return near(child.y, box.y + inset);
  if (side === "bottom") return near(child.y + child.height, box.y + box.height - inset);
  if (side === "left") return near(child.x, box.x + inset);
  return near(child.x + child.width, box.x + box.width - inset);
};

/** True when a box edge at `side` lies on the same edge of the screen box. */
const onScreenEdge = (box: Box, screen: Box, side: Side): boolean => {
  if (side === "top") return near(box.y, screen.y);
  if (side === "bottom") return near(box.y + box.height, screen.y + screen.height);
  if (side === "left") return near(box.x, screen.x);
  return near(box.x + box.width, screen.x + screen.width);
};

const paddingIssues = (
  doc: PegoDocument,
  layout: Layout,
  node: PegoNode,
  source: string,
  box: Box,
  screen: Box | null,
): PolishIssue[] => {
  if (node.type !== "frame" || (node.fill === undefined && node.stroke === undefined)) return [];
  if (node.stroke && Array.isArray(node.stroke.width)) return []; // a divider edge
  const [top, right, bottom, left] = resolveSides(node.padding, doc.variables, 0);
  const items = visibleChildren(doc, layout, node);
  const justified = (small: Side, smallInset: number, large: Side, vertical: boolean): boolean =>
    // A rounded control nested at the small inset (input with a button, pill with an avatar).
    items.some(
      (item) =>
        isPainted(item.node) &&
        radiusOf(item.node, item.box, doc) > 0 &&
        onInnerEdge(item.box, box, small, smallInset),
    ) ||
    // Safe-area padding on a screen, or on a bar or sheet that sits on the screen's edge.
    (vertical && (screen === null || onScreenEdge(box, screen, large)));
  const pair = (
    [
      ["top", top, "bottom", bottom, true],
      ["left", left, "right", right, false],
    ] as const
  ).find(([sideA, a, sideB, b, vertical]) => {
    if (!lopsided(a, b)) return false;
    const [small, smallInset, large] = a < b ? [sideA, a, sideB] : [sideB, b, sideA];
    return !justified(small, smallInset, large, vertical);
  });
  if (!pair) return [];
  return [
    {
      key: `padding:${source}`,
      severity: "warning",
      node,
      issue: `padding is lopsided: ${pair[0]} ${px(pair[1])} vs ${pair[2]} ${px(pair[3])}`,
      hint: "Use the same padding on both sides of an axis (for example [20, 20, 20, 20]); only a divider or header edge justifies a difference.",
      ...instanceOf(node, source),
    },
  ];
};

/**
 * Polish findings for one laid-out node (refs already expanded) and its direct children.
 * `source` is the node's stable id: the component id for an instance root, else `sourceId`.
 * `screen` is the box of the top-level frame holding the node, null when the node is one.
 */
export const checkPolish = (
  doc: PegoDocument,
  layout: Layout,
  node: PegoNode,
  source: string,
  screen: Box | null,
): PolishIssue[] => {
  const box = layout.get(node.id);
  if (!box || box.width <= 0 || box.height <= 0) return [];
  return [
    ...cornerIssues(doc, layout, node, source, box),
    ...iconIssues(doc, layout, node),
    ...rowIssues(doc, layout, node, source),
    ...paddingIssues(doc, layout, node, source, box, screen),
  ];
};
