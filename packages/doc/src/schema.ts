import { z } from "zod";

// --- primitives -------------------------------------------------------------

/** Reference to a document variable, e.g. "$accent". */
const variableRef = z.string().regex(/^\$[A-Za-z_][\w-]*$/, "expected a $variable reference");

/** Hex color (#rgb, #rgba, #rrggbb, #rrggbbaa) or a $variable reference. */
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
export const colorValueSchema = z.union([hexColor, variableRef]);

/** Plain number or a $variable reference. */
export const numberValueSchema = z.union([z.number(), variableRef]);

export const sizingSchema = z.union([
  z.number(),
  z.literal("fill_container"),
  z.literal("fit_content"),
]);

export const layoutSchema = z.enum(["none", "horizontal", "vertical"]);
export const justifyContentSchema = z.enum([
  "start",
  "center",
  "end",
  "space_between",
  "space_around",
]);
export const alignItemsSchema = z.enum(["start", "center", "end"]);

export const strokeSchema = z.object({
  color: colorValueSchema,
  width: numberValueSchema.default(1),
});

// --- nodes ------------------------------------------------------------------

const baseNode = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  x: numberValueSchema.default(0),
  y: numberValueSchema.default(0),
  width: sizingSchema.optional(),
  height: sizingSchema.optional(),
  rotation: numberValueSchema.optional(),
  opacity: numberValueSchema.optional(),
  /** Marks the node as a component that `ref` nodes can instantiate. */
  reusable: z.boolean().optional(),
});

const paintedNode = baseNode.extend({
  fill: colorValueSchema.optional(),
  stroke: strokeSchema.optional(),
});

const frameShape = paintedNode.extend({
  type: z.literal("frame"),
  cornerRadius: numberValueSchema.optional(),
  clip: z.boolean().optional(),
  layout: layoutSchema.default("none"),
  gap: numberValueSchema.optional(),
  padding: z.union([numberValueSchema, z.array(numberValueSchema).length(4)]).optional(),
  justifyContent: justifyContentSchema.optional(),
  alignItems: alignItemsSchema.optional(),
});
const groupShape = baseNode.extend({ type: z.literal("group") });
const rectangleSchema = paintedNode.extend({
  type: z.literal("rectangle"),
  cornerRadius: numberValueSchema.optional(),
});
const ellipseSchema = paintedNode.extend({ type: z.literal("ellipse") });
const pathSchema = paintedNode.extend({
  type: z.literal("path"),
  /** SVG path data. */
  geometry: z.string().min(1),
});
const textSchema = baseNode.extend({
  type: z.literal("text"),
  content: z.union([z.string(), variableRef]),
  fontFamily: z.string().optional(),
  fontSize: numberValueSchema.optional(),
  fontWeight: numberValueSchema.optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  fill: colorValueSchema.optional(),
});
const iconSchema = baseNode.extend({
  type: z.literal("icon"),
  iconSet: z.string().default("lucide"),
  iconName: z.string().min(1),
  fill: colorValueSchema.optional(),
});
const refSchema = baseNode.extend({
  type: z.literal("ref"),
  /** Id of the reusable node this instance points at. */
  ref: z.string().min(1),
  /** Property overrides keyed by descendant id inside the referenced component. */
  descendants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export type RectangleNode = z.infer<typeof rectangleSchema>;
export type EllipseNode = z.infer<typeof ellipseSchema>;
export type PathNode = z.infer<typeof pathSchema>;
export type TextNode = z.infer<typeof textSchema>;
export type IconNode = z.infer<typeof iconSchema>;
export type RefNode = z.infer<typeof refSchema>;
export type FrameNode = z.infer<typeof frameShape> & { children: PegoNode[] };
export type GroupNode = z.infer<typeof groupShape> & { children: PegoNode[] };
export type PegoNode =
  FrameNode | GroupNode | RectangleNode | EllipseNode | PathNode | TextNode | IconNode | RefNode;
export type PegoNodeType = PegoNode["type"];

// Recursive: containers reference the node union lazily.
export const nodeSchema: z.ZodType<PegoNode, unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    frameSchema,
    groupSchema,
    rectangleSchema,
    ellipseSchema,
    pathSchema,
    textSchema,
    iconSchema,
    refSchema,
  ]),
);
const frameSchema = frameShape.extend({ children: z.array(z.lazy(() => nodeSchema)).default([]) });
const groupSchema = groupShape.extend({ children: z.array(z.lazy(() => nodeSchema)).default([]) });

// --- variables & document ---------------------------------------------------

export const variableSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), value: hexColor }),
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("string"), value: z.string() }),
]);
/** Keyed by variable name without the leading `$`. */
export const variablesSchema = z.record(z.string(), variableSchema);

export const documentSchema = z.object({
  version: z.literal(0),
  id: z.string().min(1),
  name: z.string(),
  variables: variablesSchema.default({}),
  children: z.array(nodeSchema),
});

export type Variable = z.infer<typeof variableSchema>;
export type Variables = z.infer<typeof variablesSchema>;
export type PegoDocument = z.infer<typeof documentSchema>;
