import {
  findLocation,
  isContainer,
  MAX_INSTANCE_DEPTH,
  representativeColor,
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
import { compositeOver, contrastRatio, parseHex, wcagAaThreshold, type Rgba } from "./color";

export type Severity = "error" | "warning" | "info";

export type LayoutIssue = {
  severity: Severity;
  nodeId: string;
  name: string;
  issue: string;
  hint: string;
};

export type LayoutReport = {
  summary: string;
  total: number;
  shown: number;
  issues: LayoutIssue[];
};

export const MAX_ISSUES = 50;
const EPSILON = 0.5;
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const px = (value: number): string => `${Math.round(value * 10) / 10}`;

const label = (node: PegoNode): string => node.name ?? `${node.type} ${node.id}`;

const isHugging = (node: PegoNode, axis: "width" | "height"): boolean =>
  node.type === "frame" && (node[axis] === undefined || node[axis] === "fit_content");

const hasPaint = (node: PegoNode): boolean =>
  "fill" in node && (node.fill !== undefined || ("stroke" in node && node.stroke !== undefined));

const rightOf = (box: Box) => box.x + box.width;
const bottomOf = (box: Box) => box.y + box.height;

const intersection = (a: Box, b: Box): { width: number; height: number } => ({
  width: Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x),
  height: Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y),
});

const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x - EPSILON &&
  inner.y >= outer.y - EPSILON &&
  rightOf(inner) <= rightOf(outer) + EPSILON &&
  bottomOf(inner) <= bottomOf(outer) + EPSILON;

/** Rough line count for text in a fixed width (average glyph width 0.55em). */
const estimateTextHeight = (node: TextNode, width: number, doc: PegoDocument): number => {
  const fontSize = resolveNumber(node.fontSize, doc.variables, 16);
  const content = resolveString(node.content, doc.variables);
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lines = content
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return lines * fontSize * 1.25;
};

/**
 * Everything painted below `node` that covers its whole box, bottom to top: each ancestor, then
 * the ancestor's earlier children (drawn before the branch holding `node`) whose box contains it,
 * e.g. a colored shape that text sits on inside a `layout: none` frame.
 */
const layersBelow = (node: PegoNode, ancestors: PegoNode[], ctx: Context): PegoNode[] => {
  const box = ctx.layout.get(node.id);
  const path = [...ancestors, node];
  const layers: PegoNode[] = [];
  ancestors.forEach((ancestor, k) => {
    layers.push(ancestor);
    const onPath = path[k + 1];
    if (!box || !onPath || !isContainer(ancestor)) return;
    for (const raw of ancestor.children) {
      if (raw.id === onPath.id) break;
      const sibling = raw.type === "ref" ? resolveInstance(ctx.doc, raw) : raw;
      const siblingBox = sibling && ctx.layout.get(sibling.id);
      if (sibling && siblingBox && contains(siblingBox, box)) layers.push(sibling);
    }
  });
  return layers;
};

/**
 * The background behind a node as an opaque color: the topmost layer below it with a fill,
 * translucent fills composited over the next one down; null when nothing opaque is found.
 */
const backgroundOf = (layersBelowNode: PegoNode[], doc: PegoDocument): Rgba | null => {
  const layers: Rgba[] = [];
  for (let i = layersBelowNode.length - 1; i >= 0; i--) {
    const ancestor = layersBelowNode[i] as PegoNode;
    if (!("fill" in ancestor) || ancestor.fill === undefined) continue;
    // Contrast over an image is unknown; a gradient counts as its first stop.
    if (typeof ancestor.fill === "object" && ancestor.fill.type === "image") return null;
    const color = representativeColor(ancestor.fill, doc.variables);
    const rgba = color ? parseHex(color) : null;
    if (!rgba) continue;
    layers.push(rgba);
    if (rgba.a >= 1) break;
  }
  const base = layers.pop();
  if (!base || base.a < 1) return null;
  return layers.reduceRight((below, layer) => compositeOver(layer, below), base);
};

type Context = {
  doc: PegoDocument;
  layout: Layout;
  issues: LayoutIssue[];
};

const report = (
  ctx: Context,
  severity: Severity,
  node: PegoNode,
  issue: string,
  hint: string,
): void => {
  ctx.issues.push({ severity, nodeId: node.id, name: label(node), issue, hint });
};

const INSTANCE_HINT =
  " The node is inside a component instance: fix the component or use set_instance_overrides.";

const checkNode = (
  ctx: Context,
  node: PegoNode,
  parent: PegoNode | null,
  ancestors: PegoNode[],
): void => {
  const { doc, layout } = ctx;
  const box = layout.get(node.id);
  const suffix = node.id.includes("/") ? INSTANCE_HINT : "";
  const children = isContainer(node) ? node.children : [];

  // Structure: the top level of a page holds screens, standalone pieces (each one frame) and
  // instances, never loose layers; those frames carry a name.
  if (parent?.type === "page") {
    if (node.type !== "frame" && node.type !== "group" && node.type !== "ref") {
      report(
        ctx,
        "warning",
        node,
        `${node.type} sits loose at the top level of the page`,
        "Move it into the screen or section frame it belongs to (move_node), or wrap it together with the layers that make up the same thing (a drawing, a logo, a chart) in one frame or group named after the whole.",
      );
    } else if (node.type !== "ref" && !node.name?.trim()) {
      report(
        ctx,
        "info",
        node,
        `top-level ${node.type} has no name`,
        'Name it after what it is (for example "Home - Desktop", "Logo", "Cloud") so the layers and the agent can find it.',
      );
    }
  }

  // Zero-size and empty containers.
  if (box && (box.width <= EPSILON || box.height <= EPSILON)) {
    const emptyUnpainted = node.type === "frame" && children.length === 0 && !hasPaint(node);
    const emptyGroup = node.type === "group" && children.length === 0;
    if (!emptyUnpainted && !emptyGroup && !(node.type === "text" && box.height > EPSILON)) {
      report(
        ctx,
        "error",
        node,
        `${node.type} is ${px(box.width)}x${px(box.height)}, so it is invisible`,
        `Give it a width and height, or a layout that sizes it (fill_container / fit_content).${suffix}`,
      );
    }
  }
  if (node.type === "frame" && children.length === 0 && !hasPaint(node) && !node.reusable) {
    report(
      ctx,
      "warning",
      node,
      "empty frame with no fill or stroke",
      `Add children or a fill, or delete it. A spacer should use gap/padding on the parent instead.${suffix}`,
    );
  }

  // Overflow against the parent box.
  const parentBox = parent ? layout.get(parent.id) : undefined;
  if (parent && box && parentBox && (parent.type === "frame" || parent.type === "group")) {
    const spillRight = rightOf(box) - rightOf(parentBox);
    const spillBottom = bottomOf(box) - bottomOf(parentBox);
    const spillLeft = parentBox.x - box.x;
    const spillTop = parentBox.y - box.y;
    const worst = Math.max(spillRight, spillBottom, spillLeft, spillTop);
    if (worst > EPSILON + 0.5 && box.width > 0 && box.height > 0) {
      const clips = parent.type === "frame" && parent.clip === true;
      const sides = [
        spillRight > EPSILON && `right ${px(spillRight)}`,
        spillBottom > EPSILON && `bottom ${px(spillBottom)}`,
        spillLeft > EPSILON && `left ${px(spillLeft)}`,
        spillTop > EPSILON && `top ${px(spillTop)}`,
      ].filter(Boolean);
      report(
        ctx,
        clips ? "error" : "warning",
        node,
        `extends outside "${label(parent)}" (${sides.join(", ")} px)${clips ? "; the parent clips, so this part is cut off" : ""}`,
        `Resize the parent (fit_content grows with children), shrink this node, or use fill_container.${suffix}`,
      );
    }
  }

  // Text that likely needs more height than a fixed height gives.
  if (node.type === "text" && box && typeof node.height === "number") {
    const needed = estimateTextHeight(node, box.width, doc);
    if (needed > node.height + 2) {
      report(
        ctx,
        "warning",
        node,
        `text needs about ${px(needed)}px of height but is fixed at ${px(node.height)}px`,
        `Remove the fixed height so the text sizes itself, or enlarge it.${suffix}`,
      );
    }
  }

  // Text contrast against what is painted below it (ancestor fills and shapes it sits on).
  if (node.type === "text") {
    const color = resolveColor(node.fill, doc.variables);
    const fg = color ? parseHex(color) : null;
    const bg = fg ? backgroundOf(layersBelow(node, ancestors, ctx), doc) : null;
    if (fg && bg) {
      const ratio = contrastRatio(compositeOver(fg, bg), bg);
      const needed = wcagAaThreshold(
        resolveNumber(node.fontSize, doc.variables, 16),
        resolveNumber(node.fontWeight, doc.variables, 400),
      );
      if (ratio < needed) {
        report(
          ctx,
          ratio < 3 ? "error" : "warning",
          node,
          `text contrast ${ratio.toFixed(2)}:1 is below WCAG AA (${needed}:1)`,
          `Use a text color with more contrast against the background (usually a $text variable on $bg or $surface).${suffix}`,
        );
      }
    }
  }

  if (!isContainer(node)) return;

  // Flex children with x/y (ignored by layout).
  if (node.type === "frame" && node.layout !== "none") {
    for (const child of children) {
      const x = resolveNumber(child.x, doc.variables, 0);
      const y = resolveNumber(child.y, doc.variables, 0);
      if (x !== 0 || y !== 0) {
        report(
          ctx,
          "info",
          child,
          `x/y are set (${px(x)}, ${px(y)}) but "${label(node)}" lays out its children, so they are ignored`,
          "Remove x and y, and use gap, padding and alignItems on the parent. Set the parent layout to none to position freely.",
        );
      }
    }
  }

  // Partially overlapping siblings in free-positioned containers.
  const freeform = node.type === "group" || (node.type === "frame" && node.layout === "none");
  if (freeform) {
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i] as PegoNode;
        const b = children[j] as PegoNode;
        const boxA = layout.get(a.id);
        const boxB = layout.get(b.id);
        if (!boxA || !boxB) continue;
        const overlap = intersection(boxA, boxB);
        if (overlap.width <= 2 || overlap.height <= 2) continue;
        if (contains(boxA, boxB) || contains(boxB, boxA)) continue; // background + content is intended
        report(
          ctx,
          a.type === "text" && b.type === "text" ? "error" : "warning",
          b,
          `overlaps sibling "${label(a)}" by ${px(overlap.width)}x${px(overlap.height)}px`,
          `Move one of them, or put both in a frame with layout horizontal or vertical so they cannot collide.${suffix}`,
        );
      }
    }
  }

  // fill_container where the parent hugs and every child fills (nothing gives the parent a size).
  if (node.type === "frame" && children.length > 0) {
    for (const axis of ["width", "height"] as const) {
      if (!isHugging(node, axis)) continue;
      if (!children.every((child) => child[axis] === "fill_container")) continue;
      const parentSize = box ? box[axis] : undefined;
      report(
        ctx,
        parentSize !== undefined && parentSize <= EPSILON ? "error" : "warning",
        node,
        `every child is fill_container in ${axis}, but "${label(node)}" hugs its content on that axis (circular)`,
        `Give "${label(node)}" a fixed ${axis}, or fill_container in its own parent, or give a child a fixed ${axis}.${suffix}`,
      );
    }
  }
};

const walk = (
  ctx: Context,
  node: PegoNode,
  parent: PegoNode | null,
  ancestors: PegoNode[],
  depth: number,
  scopeId: string | undefined,
  inScope: boolean,
): void => {
  const expanded =
    node.type === "ref"
      ? depth < MAX_INSTANCE_DEPTH
        ? resolveInstance(ctx.doc, node)
        : null
      : node;
  if (!expanded) return;
  const nowInScope = inScope || scopeId === undefined || node.id === scopeId;
  if (nowInScope) checkNode(ctx, expanded, parent, ancestors);
  if (!isContainer(expanded)) return;
  const nextAncestors = [...ancestors, expanded];
  for (const child of expanded.children) {
    walk(ctx, child, expanded, nextAncestors, depth + 1, scopeId, nowInScope);
  }
};

/** Pure analysis of a document and its computed layout. `nodeId` limits it to one subtree. */
export const checkLayout = (doc: PegoDocument, layout: Layout, nodeId?: string): LayoutReport => {
  if (nodeId !== undefined && !findLocation(doc, nodeId)) {
    throw new Error(`node "${nodeId}" not found`);
  }
  const ctx: Context = { doc, layout, issues: [] };
  for (const node of doc.children) walk(ctx, node, null, [], 0, nodeId, false);

  const sorted = ctx.issues
    .map((issue, index) => ({ issue, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.index - b.index,
    )
    .map(({ issue }) => issue);
  const count = (severity: Severity) => sorted.filter((i) => i.severity === severity).length;
  const issues = sorted.slice(0, MAX_ISSUES);
  const summary =
    sorted.length === 0
      ? "No layout issues found."
      : `${sorted.length} issue(s): ${count("error")} error, ${count("warning")} warning, ${count("info")} info${sorted.length > issues.length ? `; showing the first ${issues.length}, fix these and run again` : ""}.`;
  return { summary, total: sorted.length, shown: issues.length, issues };
};
