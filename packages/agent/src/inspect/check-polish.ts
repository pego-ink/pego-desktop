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
};

/** Largest even inset at which nested corners should be concentric. */
const MAX_CONCENTRIC_INSET = 24;
/** Lucide strokes are 2 on a 24 grid, so an icon under 16px draws under 1.33px. */
const MIN_ICON_BESIDE_BOLD = 16;
const BOLD = 600;
const EDGE = 0.5;

const px = (value: number): string => `${Math.round(value * 10) / 10}`;

const label = (node: PegoNode): string => node.name ?? `${node.type} ${node.id}`;

/** The source part of a render id: instance children are `<instanceId>/<sourceId>`. */
export const sourceId = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

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
        severity: "warning",
        node,
        issue: `corner of "${label(child.node)}" (radius ${px(inner)}) is rounder than its parent's (radius ${px(outer)})`,
        hint: `Concentric corners: give "${label(node)}" cornerRadius ${px(expected)} (${sum}), or lower the child's radius.`,
      });
    } else if (Math.abs(outer - expected) > 2) {
      issues.push({
        key,
        severity: "info",
        node,
        issue: `corner radius ${px(outer)} is not concentric with "${label(child.node)}" (radius ${px(inner)}, inset ${px(inset)})`,
        hint: `Concentric corners: parent radius = ${sum} = ${px(expected)}. Use it or the closest radius token.`,
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
    });
  });
  return issues;
};

/** A painted frame that is not stretched: a card that can end at its own height. */
const isLooseCard = (node: PegoNode): boolean =>
  node.type === "frame" &&
  (node.fill !== undefined || node.stroke !== undefined) &&
  node.height !== "fill_container";

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
    },
  ];
};

const lopsided = (a: number, b: number): boolean => {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return low > 0 && high >= 2 * low && high - low >= 8;
};

const paddingIssues = (doc: PegoDocument, node: PegoNode, source: string): PolishIssue[] => {
  if (node.type !== "frame" || (node.fill === undefined && node.stroke === undefined)) return [];
  if (node.stroke && Array.isArray(node.stroke.width)) return []; // a divider edge
  const [top, right, bottom, left] = resolveSides(node.padding, doc.variables, 0);
  const pair = (
    [
      ["top", top, "bottom", bottom],
      ["left", left, "right", right],
    ] as const
  ).find(([, a, , b]) => lopsided(a, b));
  if (!pair) return [];
  return [
    {
      key: `padding:${source}`,
      severity: "warning",
      node,
      issue: `padding is lopsided: ${pair[0]} ${px(pair[1])} vs ${pair[2]} ${px(pair[3])}`,
      hint: "Use the same padding on both sides of an axis (for example [20, 20, 20, 20]); only a divider or header edge justifies a difference.",
    },
  ];
};

/**
 * Polish findings for one laid-out node (refs already expanded) and its direct children.
 * `source` is the node's stable id: the component id for an instance root, else `sourceId`.
 */
export const checkPolish = (
  doc: PegoDocument,
  layout: Layout,
  node: PegoNode,
  source: string,
): PolishIssue[] => {
  const box = layout.get(node.id);
  if (!box || box.width <= 0 || box.height <= 0) return [];
  return [
    ...cornerIssues(doc, layout, node, source, box),
    ...iconIssues(doc, layout, node),
    ...rowIssues(doc, layout, node, source),
    ...paddingIssues(doc, node, source),
  ];
};
