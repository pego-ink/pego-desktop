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

/** A gradient color stop; `position` runs from 0 (start) to 1 (end). */
export const gradientStopSchema = z.object({
  color: colorValueSchema,
  position: z.number().min(0).max(1),
});
const stops = z.array(gradientStopSchema).min(2);
/** Fraction of the node's size, e.g. [0.5, 0.5] = the center. */
const fraction2 = z.tuple([z.number(), z.number()]);

/** Like CSS `linear-gradient(<angle>deg, ...)`: 0 points up, 90 right, 180 (default) down. */
export const linearGradientSchema = z.object({
  type: z.literal("linear"),
  angle: numberValueSchema.default(180),
  stops,
});
/** Ellipse at `center` with radii `radius`, both as fractions of the node's width and height. */
export const radialGradientSchema = z.object({
  type: z.literal("radial"),
  center: fraction2.default([0.5, 0.5]),
  radius: fraction2.default([0.5, 0.5]),
  stops,
});
/** Raster image embedded as a base64 data URI, scaled like CSS `background-size`. */
export const imageFillSchema = z.object({
  type: z.literal("image"),
  src: z
    .string()
    .regex(
      /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/,
      "expected a base64 image data URI",
    ),
  fit: z.enum(["cover", "contain", "stretch"]).default("cover"),
});
/** Built-in shader looks (`shaders.ts`); `custom` runs the fill's own `code`. */
export const shaderPresetSchema = z.enum([
  "aurora",
  "gradient_flow",
  "waves",
  "grain",
  "shimmer",
  "dots",
  "custom",
]);
/** A float, a vec2-4, or a color (hex or `$variable`, read as r, g, b[, a] in 0..1). */
export const shaderUniformValueSchema = z.union([
  z.number(),
  z.array(z.number()).min(2).max(4),
  colorValueSchema,
]);
/** A fragment shader paints the shape (see `shaders.ts` for the code format). */
export const shaderFillSchema = z.object({
  type: z.literal("shader"),
  preset: shaderPresetSchema,
  /** Code of a `custom` shader: `vec4 main(vec2 fragCoord)`, with `iResolution` and `iTime`. */
  code: z.string().max(20_000).optional(),
  /** Uniform values by name, over the preset's defaults. */
  uniforms: z.record(z.string(), shaderUniformValueSchema).optional(),
});
/** What shapes are filled with: a color, a gradient, an image or a shader. */
export const fillSchema = z.union([
  colorValueSchema,
  z.discriminatedUnion("type", [
    linearGradientSchema,
    radialGradientSchema,
    imageFillSchema,
    shaderFillSchema,
  ]),
]);

/** One value for every side, or `[top, right, bottom, left]` (CSS order). */
export const sidesSchema = z.union([numberValueSchema, z.array(numberValueSchema).length(4)]);

export const strokeSchema = z.object({
  color: colorValueSchema,
  /** One width, or per side `[top, right, bottom, left]`; 0 hides a side. */
  width: sidesSchema.default(1),
});

/** Drop shadow (outside the shape) or inner shadow, like CSS box-shadow. */
export const shadowEffectSchema = z.object({
  type: z.literal("shadow"),
  inner: z.boolean().optional(),
  color: colorValueSchema,
  x: numberValueSchema.default(0),
  y: numberValueSchema.default(0),
  blur: numberValueSchema.default(0),
  spread: numberValueSchema.optional(),
});
/** Gaussian blur of the whole layer, like CSS `filter: blur()`. */
export const blurEffectSchema = z.object({
  type: z.literal("blur"),
  radius: numberValueSchema,
});
export const effectSchema = z.discriminatedUnion("type", [shadowEffectSchema, blurEffectSchema]);
/** Drawn in order: shadows below the node, inner shadows above its fill, blur on the whole layer. */
const effects = z.array(effectSchema).optional();

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
  /** `false` hides the node and its children: not drawn, not hit, no room in a flex layout, not exported. */
  visible: z.boolean().optional(),
});

// --- motion -----------------------------------------------------------------

/**
 * How a node enters when the design plays (preview, exports). `none` moves nothing (for a text that
 * only counts up); `grow_up` / `grow_right` grow from the bottom / left edge, like a bar.
 */
export const animationPresetSchema = z.enum([
  "none",
  "fade",
  "slide_up",
  "slide_down",
  "slide_left",
  "slide_right",
  "grow_up",
  "grow_right",
  "scale",
  "pop",
]);
export const animationEasingSchema = z.enum(["ease_out", "ease_in_out", "linear", "spring"]);
export const animationSchema = z.object({
  preset: animationPresetSchema,
  /** Milliseconds after playback starts. Default 0. */
  delay: z.number().min(0).max(60_000).optional(),
  /** Milliseconds. Default 600. */
  duration: z.number().min(1).max(60_000).optional(),
  /** Default `ease_out`. */
  easing: animationEasingSchema.optional(),
  /** Text only: every number in the content counts up from 0 while it plays ("70%", "± 6"). */
  countUp: z.boolean().optional(),
});

/** Every node that renders (everything but pages): adds the mirror flags and the entrance. */
const renderedNode = baseNode.extend({
  /** Mirror left-right around the node's own box center (applied before rotation). */
  flipX: z.boolean().optional(),
  /** Mirror top-bottom around the node's own box center (applied before rotation). */
  flipY: z.boolean().optional(),
  /** Entrance played in preview and exports; the canvas shows the end state while editing. */
  animation: animationSchema.optional(),
});

const paintedNode = renderedNode.extend({
  fill: fillSchema.optional(),
  stroke: strokeSchema.optional(),
  effects,
});

const frameShape = paintedNode.extend({
  type: z.literal("frame"),
  cornerRadius: numberValueSchema.optional(),
  clip: z.boolean().optional(),
  layout: layoutSchema.default("none"),
  gap: numberValueSchema.optional(),
  padding: sidesSchema.optional(),
  justifyContent: justifyContentSchema.optional(),
  alignItems: alignItemsSchema.optional(),
  /**
   * Marks a frame inside a component as a slot: each instance may fill it with its own content
   * (see resolveInstance). Lists the components recommended for it (may be empty).
   */
  slot: z.array(z.string().min(1)).max(50).optional(),
});
const groupShape = renderedNode.extend({ type: z.literal("group") });
/**
 * A page: the top level of a document. Pages sit only at the document root and hold the
 * canvas content (screens, components). Their x/y are unused.
 */
const pageShape = baseNode.extend({
  type: z.literal("page"),
  name: z.string().default("Page"),
  /**
   * The page holds a library: the components of another project's design, copied in so this
   * document can use them, and updated from that project on request.
   */
  library: z
    .object({
      projectId: z.string().min(1),
      name: z.string(),
      /** The library project's design file, read again on update. */
      path: z.string().min(1),
      /** When the components were last copied (ms since epoch). */
      syncedAt: z.number(),
    })
    .optional(),
});
const rectangleSchema = paintedNode.extend({
  type: z.literal("rectangle"),
  cornerRadius: numberValueSchema.optional(),
});
const ellipseSchema = paintedNode.extend({ type: z.literal("ellipse") });
/** Decoration at an open path's start or end (arrows, dots, bars). */
export const pathMarkerSchema = z.enum(["none", "arrow", "triangle", "circle", "bar"]);

const pathSchema = paintedNode.extend({
  type: z.literal("path"),
  /** SVG path data, in the node's local coordinates. */
  geometry: z.string().min(1),
  /** `[minX, minY, width, height]` of the geometry; when set, it is scaled to the node's size. */
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  strokeCap: z.enum(["butt", "round", "square"]).optional(),
  strokeJoin: z.enum(["miter", "round", "bevel"]).optional(),
  startMarker: pathMarkerSchema.optional(),
  endMarker: pathMarkerSchema.optional(),
});
/**
 * Bitmap image. `src` is a data: URL (embedded, travels with the .pego file) or an https URL.
 * `fit`: fill = cover the box (crop overflow), fit = contain, crop = no scaling, tile = repeat.
 */
const imageSchema = renderedNode.extend({
  type: z.literal("image"),
  src: z.string().min(1),
  fit: z.enum(["fill", "fit", "crop", "tile"]).optional(),
  cornerRadius: numberValueSchema.optional(),
  stroke: strokeSchema.optional(),
  /** Optional alt text, used by exports and agents. */
  alt: z.string().optional(),
  /**
   * Where a screenshot came from: the page (and the element, by a unique selector) in the in-app
   * browser, so it can be refreshed from the live page.
   */
  source: z
    .object({
      url: z
        .string()
        .min(1)
        .max(2000)
        .regex(/^https?:\/\//i, "must be an http(s) URL"),
      selector: z.string().min(1).max(1000).optional(),
    })
    .optional(),
});
const textSchema = renderedNode.extend({
  type: z.literal("text"),
  content: z.union([z.string(), variableRef]),
  /** Family name or a $variable (string). */
  fontFamily: z.string().optional(),
  fontSize: numberValueSchema.optional(),
  fontWeight: numberValueSchema.optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  /** Multiple of the font size, e.g. 1.5. Omitted = the font's natural line height. */
  lineHeight: numberValueSchema.optional(),
  /** Extra space between characters, in pixels. */
  letterSpacing: numberValueSchema.optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  fill: colorValueSchema.optional(),
  effects,
});
const iconSchema = renderedNode.extend({
  type: z.literal("icon"),
  iconSet: z.string().default("lucide"),
  iconName: z.string().min(1),
  fill: colorValueSchema.optional(),
  effects,
});
const refSchema = renderedNode.extend({
  type: z.literal("ref"),
  /** Id of the reusable node this instance points at. */
  ref: z.string().min(1),
  /** Property overrides keyed by descendant id inside the referenced component. */
  descendants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export type Stroke = z.infer<typeof strokeSchema>;
export type GradientStop = z.infer<typeof gradientStopSchema>;
export type LinearGradient = z.infer<typeof linearGradientSchema>;
export type RadialGradient = z.infer<typeof radialGradientSchema>;
export type ImageFill = z.infer<typeof imageFillSchema>;
export type ShaderFill = z.infer<typeof shaderFillSchema>;
export type ShaderPreset = z.infer<typeof shaderPresetSchema>;
export type ShaderUniformValue = z.infer<typeof shaderUniformValueSchema>;
export type Fill = z.infer<typeof fillSchema>;
export type ShadowEffect = z.infer<typeof shadowEffectSchema>;
export type BlurEffect = z.infer<typeof blurEffectSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Animation = z.infer<typeof animationSchema>;
export type AnimationPreset = z.infer<typeof animationPresetSchema>;
export type AnimationEasing = z.infer<typeof animationEasingSchema>;
export type RectangleNode = z.infer<typeof rectangleSchema>;
export type EllipseNode = z.infer<typeof ellipseSchema>;
export type PathNode = z.infer<typeof pathSchema>;
export type TextNode = z.infer<typeof textSchema>;
export type IconNode = z.infer<typeof iconSchema>;
export type RefNode = z.infer<typeof refSchema>;
export type ImageNode = z.infer<typeof imageSchema>;
export type FrameNode = z.infer<typeof frameShape> & { children: PegoNode[] };
export type GroupNode = z.infer<typeof groupShape> & { children: PegoNode[] };
export type PageNode = z.infer<typeof pageShape> & { children: PegoNode[] };
export type PegoNode =
  | FrameNode
  | GroupNode
  | PageNode
  | RectangleNode
  | EllipseNode
  | PathNode
  | TextNode
  | IconNode
  | RefNode
  | ImageNode;
export type PegoNodeType = PegoNode["type"];

// Recursive: containers reference the node union lazily.
/** Any node that can sit on a page or inside a frame/group (everything but a page). */
export const contentNodeSchema: z.ZodType<PegoNode, unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    frameSchema,
    groupSchema,
    rectangleSchema,
    ellipseSchema,
    pathSchema,
    textSchema,
    iconSchema,
    refSchema,
    imageSchema,
  ]),
);
const children = z.array(z.lazy(() => contentNodeSchema)).default([]);
const frameSchema = frameShape.extend({ children });
const groupSchema = groupShape.extend({ children });
const pageObjectSchema = pageShape.extend({ children });
export const pageSchema: z.ZodType<PageNode, unknown> = pageObjectSchema;
/** Any node, pages included (ops validate where each may go). */
export const nodeSchema: z.ZodType<PegoNode, unknown> = z.lazy(() =>
  // One discriminated union (not a union of unions) keeps validation errors specific.
  z.discriminatedUnion("type", [
    frameSchema,
    groupSchema,
    pageObjectSchema,
    rectangleSchema,
    ellipseSchema,
    pathSchema,
    textSchema,
    iconSchema,
    refSchema,
    imageSchema,
  ]),
);

// --- variables & document ---------------------------------------------------

export const variableSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), value: hexColor }),
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("string"), value: z.string() }),
]);
/** Keyed by variable name without the leading `$`. */
export const variablesSchema = z.record(z.string(), variableSchema);

/** Current document format version; older documents go through `migrateDocument` first. */
export const DOCUMENT_VERSION = 7;

export const documentSchema = z.object({
  version: z.literal(DOCUMENT_VERSION),
  id: z.string().min(1),
  name: z.string(),
  variables: variablesSchema.default({}),
  /** Pages, in order. A document always has at least one. */
  children: z.array(pageSchema).min(1),
});

export type Variable = z.infer<typeof variableSchema>;
export type Variables = z.infer<typeof variablesSchema>;
export type PegoDocument = z.infer<typeof documentSchema>;
