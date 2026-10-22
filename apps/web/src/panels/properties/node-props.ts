import type { PegoNode, PegoNodeType, ShadowEffect } from "@pego/doc";

export const rawProp = (node: PegoNode, key: string): unknown =>
  (node as unknown as Record<string, unknown>)[key];

/** `$name` when the value is a variable reference. */
export const variableOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.startsWith("$") ? value : undefined;

const FILLED: ReadonlySet<PegoNodeType> = new Set([
  "frame",
  "rectangle",
  "ellipse",
  "path",
  "text",
  "icon",
]);
const STROKED: ReadonlySet<PegoNodeType> = new Set(["frame", "rectangle", "ellipse", "path"]);
/** Nodes whose fill can be a gradient or image, not just a color. */
const SHAPE_FILLED: ReadonlySet<PegoNodeType> = new Set(["frame", "rectangle", "ellipse", "path"]);
const ROUNDED: ReadonlySet<PegoNodeType> = new Set(["frame", "rectangle"]);

export const hasFill = (node: PegoNode) => FILLED.has(node.type);
/** Every painted node takes effects: the same set as fill. */
export const hasEffects = hasFill;
export const hasShapeFill = (node: PegoNode) => SHAPE_FILLED.has(node.type);
export const hasStroke = (node: PegoNode) => STROKED.has(node.type);
export const hasCornerRadius = (node: PegoNode) => ROUNDED.has(node.type);

export const DEFAULT_FILL = "#D9D9D9";
export const DEFAULT_STROKE = { color: "#FFFFFF", width: 1 } as const;
export const DEFAULT_SHADOW = {
  type: "shadow",
  color: "#00000040",
  x: 0,
  y: 4,
  blur: 12,
} as const satisfies ShadowEffect;
