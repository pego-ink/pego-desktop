import {
  findRenderedNode,
  resolveColor,
  resolveNumber,
  resolveString,
  type Layout,
  type PegoDocument,
  type PegoNode,
  type TextNode,
  type Variables,
} from "@pego/doc";

/** Pego's text defaults, the same the renderer uses. */
export const DEFAULT_FONT_FAMILY = "Inter";
export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_FONT_WEIGHT = 400;
export const DEFAULT_TEXT_COLOR = "#000000";
export const DEFAULT_ICON_COLOR = "#FFFFFF";

/** Inner SVG markup of an icon drawn on a 24x24 grid with stroke="currentColor"; null if unknown. */
export type IconMarkup = (iconName: string, iconSet: string) => string | null;

export const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

/** Short, stable number formatting for markup (no -0, at most 3 decimals). */
export const num = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

export type ResolvedText = {
  content: string;
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing: number;
  align: "left" | "center" | "right";
  color: string;
};

export const resolveText = (node: TextNode, variables: Variables): ResolvedText => ({
  content: resolveString(node.content, variables),
  family:
    node.fontFamily === undefined ? DEFAULT_FONT_FAMILY : resolveString(node.fontFamily, variables),
  size: resolveNumber(node.fontSize, variables, DEFAULT_FONT_SIZE),
  weight: resolveNumber(node.fontWeight, variables, DEFAULT_FONT_WEIGHT),
  lineHeight: resolveNumber(node.lineHeight, variables, 0),
  letterSpacing: resolveNumber(node.letterSpacing, variables, 0),
  align: node.textAlign ?? "left",
  color:
    (typeof node.fill === "string" ? resolveColor(node.fill, variables) : undefined) ??
    DEFAULT_TEXT_COLOR,
});

/** Text wraps when its width is fixed or given by the parent, as in computeLayout. */
export const textWraps = (node: TextNode): boolean =>
  typeof node.width === "number" || node.width === "fill_container";

/** The export root: the rendered node (refs expanded) with its layout box. */
export const exportRoot = (doc: PegoDocument, layout: Layout, rootId: string) => {
  const node = findRenderedNode(doc, rootId);
  const box = node && layout.get(node.id);
  if (!node || !box) throw new Error(`Unknown node: ${rootId}`);
  return { node, box };
};

export type { PegoNode };
