import {
  findLocation,
  isContainer,
  OpError,
  pageOrFirst,
  placedByLayout,
  type Animation,
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

/** Short stand-in for an image source: never put base64 into the model context. */
export const describeSrc = (src: string): string => {
  const data = /^data:([^;,]+)/i.exec(src);
  if (data) return `<data:${data[1]} ${formatBytes(Math.floor((src.length * 3) / 4))}>`;
  return src.length > 120 ? JSON.stringify(`${src.slice(0, 117)}...`) : JSON.stringify(src);
};

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;

const fmtStroke = (stroke: Stroke): string =>
  `${fmt(stroke.color)}:${Array.isArray(stroke.width) ? JSON.stringify(stroke.width) : stroke.width}`;

/** Colors as tokens; gradients as `linear(180,#000 0,#fff 1)`; images by size only (data URIs are huge). */
const fmtFill = (fill: Fill): string => {
  if (typeof fill === "string") return fmt(fill);
  if (fill.type === "image")
    return `image(${fill.fit},${Math.round((fill.src.length * 3) / 4 / 1024)}KB)`;
  if (fill.type === "shader") {
    const uniforms = Object.entries(fill.uniforms ?? {}).map(([k, v]) => `${k}=${fmt(v)}`);
    const code = fill.preset === "custom" ? [`code=${(fill.code ?? "").length}chars`] : [];
    return `shader(${[fill.preset, ...uniforms, ...code].join(",")})`;
  }
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

/** `grow_up(delay=150,duration=500,easing=spring,countUp)`: only the fields that are set. */
const fmtAnimation = (animation: Animation): string => {
  const parts: string[] = [];
  if (animation.delay !== undefined) parts.push(`delay=${animation.delay}`);
  if (animation.duration !== undefined) parts.push(`duration=${animation.duration}`);
  if (animation.easing !== undefined) parts.push(`easing=${animation.easing}`);
  if (animation.countUp) parts.push("countUp");
  return parts.length > 0 ? `${animation.preset}(${parts.join(",")})` : animation.preset;
};

/** Props in a fixed order. Defaults (x/y = 0, layout none, iconSet lucide) are omitted. */
const propTokens = (node: PegoNode, showPosition: boolean): string[] => {
  const n = node as PegoNode & Fields;
  const tokens: string[] = [];
  const push = (key: string, value: unknown): void => {
    if (value !== undefined) tokens.push(`${key}=${fmt(value)}`);
  };

  if (n.layoutPosition === "absolute") push("layoutPosition", "absolute");
  if (showPosition) {
    if (n.x !== 0) push("x", n.x);
    if (n.y !== 0) push("y", n.y);
  }
  push("width", n.width);
  push("height", n.height);
  push("rotation", n.rotation);
  if (n.flipX) push("flipX", true);
  if (n.flipY) push("flipY", true);
  push("opacity", n.opacity);
  if (n.fill !== undefined) tokens.push(`fill=${fmtFill(n.fill as Fill)}`);
  if (n.stroke) tokens.push(`stroke=${fmtStroke(n.stroke as Stroke)}`);
  const effects = n.effects as Effect[] | undefined;
  if (effects && effects.length > 0) tokens.push(`effects=${effects.map(fmtEffect).join("+")}`);
  const animation = n.animation as Animation | undefined;
  if (animation) tokens.push(`animation=${fmtAnimation(animation)}`);
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
  if (n.type === "path") {
    push("strokeCap", n.strokeCap);
    push("strokeJoin", n.strokeJoin);
    push("startMarker", n.startMarker);
    push("endMarker", n.endMarker);
  }
  if (n.type === "image") {
    tokens.push(`src=${describeSrc(n.src as string)}`);
    push("fit", n.fit);
    push("alt", n.alt);
  }
  if (n.type === "text") {
    tokens.push(`content=${JSON.stringify(n.content)}`);
    push("fontFamily", n.fontFamily);
    push("fontSize", n.fontSize);
    push("fontWeight", n.fontWeight);
    push("fontStyle", n.fontStyle);
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
  if (n.type === "connector") {
    // `from=login(right)`: the side only when it is not auto.
    const end = (e: { id: string; side?: string }) =>
      e.side && e.side !== "auto" ? `${e.id}(${e.side})` : e.id;
    tokens.push(`from=${end(n.from as { id: string })}`, `to=${end(n.to as { id: string })}`);
    push("route", n.route);
    if (n.label) tokens.push(`label=${JSON.stringify(n.label)}`);
    push("startMarker", n.startMarker);
    push("endMarker", n.endMarker);
  }
  return tokens;
};

const nodeLine = (node: PegoNode, indent: number, showPosition: boolean, summary: string) => {
  const head = `${"  ".repeat(indent)}${node.type}#${node.id}`;
  const parts = [head];
  if (node.name) parts.push(JSON.stringify(node.name));
  if (node.reusable) parts.push("[component]");
  // Hidden layers are not on the canvas; set visible: true (update_node) to show one again.
  if (node.visible === false) parts.push("[hidden]");
  // A slot: instances may fill it (descendants[slotId].children), ideally with these components.
  if (node.type === "frame" && node.slot) {
    parts.push(node.slot.length > 0 ? `[slot: ${node.slot.join(", ")}]` : "[slot]");
  }
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
  // Children of a flex frame are positioned by layout (unless absolute); others keep their x/y.
  for (const child of children)
    serializeNodes(child, depth + 1, maxDepth, !placedByLayout(node, child), lines);
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
    serializeNodes(loc.node, 0, maxDepth, !placedByLayout(parent, loc.node), lines);
  } else {
    lines.push(`tree of page ${active.id}:`);
    for (const node of active.children) serializeNodes(node, 0, maxDepth, true, lines);
  }
  return lines.join("\n");
};
