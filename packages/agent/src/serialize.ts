import {
  findLocation,
  isContainer,
  OpError,
  pageOrFirst,
  type Effect,
  type Fill,
  type PegoDocument,
  type PegoNode,
  type Stroke,
  type Variables,
} from "@pego/doc";

export type SerializeOptions = {
  /** Start at this node instead of the whole document. */
  rootId?: string;
  /** Levels shown below the starting level; deeper containers are summarized as child counts. */
  maxDepth?: number;
  /** Page whose tree is shown without rootId (the user's page; default: the first). */
  pageId?: string | null;
};

type Fields = Record<string, unknown>;

/** Bare tokens stay unquoted (colors, $variables, numbers, keywords); everything else is JSON. */
const fmt = (value: unknown): string => {
  if (typeof value === "string") return /^[#$\w.-]+$/.test(value) ? value : JSON.stringify(value);
  return JSON.stringify(value);
};

const GEOMETRY_PREVIEW = 48;

const fmtStroke = (stroke: Stroke): string =>
  `${fmt(stroke.color)}:${Array.isArray(stroke.width) ? JSON.stringify(stroke.width) : stroke.width}`;

/** Colors as tokens; gradients as `linear(180,#000 0,#fff 1)`; images by size only (data URIs are huge). */
const fmtFill = (fill: Fill): string => {
  if (typeof fill === "string") return fmt(fill);
  if (fill.type === "image")
    return `image(${fill.fit},${Math.round((fill.src.length * 3) / 4 / 1024)}KB)`;
  const stops = fill.stops.map((stop) => `${stop.color} ${stop.position}`).join(",");
  if (fill.type === "linear") return `linear(${fill.angle},${stops})`;
  return `radial(${fill.center.join(" ")},${fill.radius.join(" ")},${stops})`;
};

/** `shadow(x,y,blur[,spread],color)`, `inner-shadow(...)` or `blur(radius)`, comma-free between effects. */
const fmtEffect = (effect: Effect): string => {
  if (effect.type === "blur") return `blur(${effect.radius})`;
  const parts = [effect.x, effect.y, effect.blur];
  if (effect.spread !== undefined) parts.push(effect.spread);
  return `${effect.inner ? "inner-shadow" : "shadow"}(${[...parts, effect.color].join(",")})`;
};

/** Props in a fixed order. Defaults (x/y = 0, layout none, iconSet lucide) are omitted. */
const propTokens = (node: PegoNode, showPosition: boolean): string[] => {
  const n = node as PegoNode & Fields;
  const tokens: string[] = [];
  const push = (key: string, value: unknown): void => {
    if (value !== undefined) tokens.push(`${key}=${fmt(value)}`);
  };

  if (showPosition) {
    if (n.x !== 0) push("x", n.x);
    if (n.y !== 0) push("y", n.y);
  }
  push("width", n.width);
  push("height", n.height);
  push("rotation", n.rotation);
  push("opacity", n.opacity);
  if (n.fill !== undefined) tokens.push(`fill=${fmtFill(n.fill as Fill)}`);
  if (n.stroke) tokens.push(`stroke=${fmtStroke(n.stroke as Stroke)}`);
  const effects = n.effects as Effect[] | undefined;
  if (effects && effects.length > 0) tokens.push(`effects=${effects.map(fmtEffect).join("+")}`);
  push("cornerRadius", n.cornerRadius);
  if (n.clip) push("clip", true);
  if (n.type === "frame") {
    if (n.layout !== "none") push("layout", n.layout);
    push("gap", n.gap);
    push("padding", n.padding);
    push("justifyContent", n.justifyContent);
    push("alignItems", n.alignItems);
  }
  if (n.type === "path") {
    const geometry = n.geometry as string;
    const cut = geometry.length > GEOMETRY_PREVIEW;
    const shown = cut ? `${geometry.slice(0, GEOMETRY_PREVIEW)}...` : geometry;
    tokens.push(`geometry=${JSON.stringify(shown)}${cut ? `(${geometry.length} chars)` : ""}`);
    push("viewBox", n.viewBox);
  }
  if (n.type === "text") {
    tokens.push(`content=${JSON.stringify(n.content)}`);
    push("fontFamily", n.fontFamily);
    push("fontSize", n.fontSize);
    push("fontWeight", n.fontWeight);
    push("lineHeight", n.lineHeight);
    push("letterSpacing", n.letterSpacing);
    push("textAlign", n.textAlign);
  }
  if (n.type === "icon") {
    if (n.iconSet !== "lucide") push("iconSet", n.iconSet);
    push("iconName", n.iconName);
  }
  if (n.type === "ref") {
    push("ref", n.ref);
    if (n.descendants && Object.keys(n.descendants).length > 0) {
      tokens.push(`descendants=${JSON.stringify(n.descendants)}`);
    }
  }
  return tokens;
};

const nodeLine = (node: PegoNode, indent: number, showPosition: boolean, summary: string) => {
  const head = `${"  ".repeat(indent)}${node.type}#${node.id}`;
  const parts = [head];
  if (node.name) parts.push(JSON.stringify(node.name));
  if (node.reusable) parts.push("[component]");
  parts.push(...propTokens(node, showPosition));
  if (summary) parts.push(summary);
  return parts.join(" ");
};

const serializeNodes = (
  node: PegoNode,
  depth: number,
  maxDepth: number,
  showPosition: boolean,
  lines: string[],
): void => {
  const children = isContainer(node) ? node.children : [];
  const collapsed = children.length > 0 && depth >= maxDepth;
  lines.push(
    nodeLine(node, depth, showPosition, collapsed ? `(${children.length} children not shown)` : ""),
  );
  if (!isContainer(node) || collapsed) return;
  // Children of a flex frame are positioned by layout; others keep their own x/y.
  const childShowsPosition = !(node.type === "frame" && node.layout !== "none");
  for (const child of children)
    serializeNodes(child, depth + 1, maxDepth, childShowsPosition, lines);
};

const countNodes = (nodes: PegoNode[]): number =>
  nodes.reduce((sum, node) => sum + 1 + (isContainer(node) ? countNodes(node.children) : 0), 0);

const variablesLine = (variables: Variables): string | null => {
  const names = Object.keys(variables).sort();
  if (names.length === 0) return null;
  const items = names.map((name) => {
    const variable = variables[name];
    return `$${name}=${variable ? fmt(variable.value) : ""} (${variable?.type})`;
  });
  return `variables: ${items.join(", ")}`;
};

const collectComponents = (nodes: PegoNode[], into: string[] = []): string[] => {
  for (const node of nodes) {
    if (node.reusable) into.push(node.name ? `${node.id} ${JSON.stringify(node.name)}` : node.id);
    if (isContainer(node)) collectComponents(node.children, into);
  }
  return into;
};

/**
 * Compact, deterministic text view of a document for the model: one line per node,
 * `type#id "name" [component] key=value ...`, children indented. Defaults are omitted
 * and key order is fixed so identical documents always serialize to identical text.
 */
export const serializeDocument = (doc: PegoDocument, opts: SerializeOptions = {}): string => {
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
  const lines = [`document ${JSON.stringify(doc.name)} id=${doc.id}`];
  const variables = variablesLine(doc.variables);
  if (variables) lines.push(variables);
  const components = collectComponents(doc.children);
  if (components.length > 0) lines.push(`components: ${components.join(", ")}`);
  const active = pageOrFirst(doc, opts.pageId);
  const pages = doc.children.map((page) => {
    const count = countNodes(page.children);
    return `${page.id} ${JSON.stringify(page.name)} (${page.id === active.id ? "active, " : ""}${count} node${count === 1 ? "" : "s"})`;
  });
  lines.push(`pages: ${pages.join(", ")}`);

  if (opts.rootId !== undefined) {
    const loc = findLocation(doc, opts.rootId);
    if (!loc) throw new OpError("node_not_found", `node "${opts.rootId}" not found`);
    lines.push(
      loc.node.type === "page"
        ? `scope: page ${loc.node.id}`
        : `scope: ${loc.node.id} (parent ${loc.parentId}, index ${loc.index}, page ${doc.children[loc.path[0]!]!.id})`,
    );
    lines.push("tree:");
    const parent = loc.parentId === null ? null : findLocation(doc, loc.parentId)?.node;
    const showPosition = !(parent && parent.type === "frame" && parent.layout !== "none");
    serializeNodes(loc.node, 0, maxDepth, showPosition, lines);
  } else {
    lines.push(`tree of page ${active.id}:`);
    for (const node of active.children) serializeNodes(node, 0, maxDepth, true, lines);
  }
  return lines.join("\n");
};
