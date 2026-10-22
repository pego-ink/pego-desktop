import type { PegoNode, PegoNodeType } from "@pego/doc";

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
const ROUNDED: ReadonlySet<PegoNodeType> = new Set(["frame", "rectangle"]);

export const hasFill = (node: PegoNode) => FILLED.has(node.type);
export const hasStroke = (node: PegoNode) => STROKED.has(node.type);
export const hasCornerRadius = (node: PegoNode) => ROUNDED.has(node.type);

export const DEFAULT_FILL = "#D9D9D9";
export const DEFAULT_STROKE = { color: "#FFFFFF", width: 1 } as const;
