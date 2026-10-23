import type { JsonSchema } from "./types";

// Compact on purpose: these schemas are repeated in several tools and sent with every request.
// Exact formats live in NODE_FORMAT_DESCRIPTION; zod validates every input and its errors explain
// what was wrong, so the JSON Schema only needs to steer the shape.

const colorValue: JsonSchema = { type: "string", description: "Hex color or $variable." };
const numberValue: JsonSchema = { type: ["number", "string"] };
const sides = (description: string): JsonSchema => ({
  anyOf: [numberValue, { type: "array", items: numberValue, minItems: 4, maxItems: 4 }],
  description,
});
const fillValue: JsonSchema = {
  anyOf: [{ type: "string" }, { type: "object" }],
  description:
    "Hex color or $variable; shapes also take a gradient, image or shader object (see node format).",
};
const sizing: JsonSchema = {
  type: ["number", "string"],
  description: "Pixels, fill_container or fit_content.",
};

const MARKERS = ["none", "arrow", "triangle", "circle", "bar"];

/** Settable node props (everything except id, type and children). */
const nodePropSchemas: Record<string, JsonSchema> = {
  name: { type: "string", description: "Layer name shown in the layers panel." },
  x: numberValue,
  y: numberValue,
  width: sizing,
  height: sizing,
  rotation: numberValue,
  flipX: {
    type: "boolean",
    description: "Mirror left-right around the node's center. Not on pages.",
  },
  flipY: {
    type: "boolean",
    description: "Mirror top-bottom around the node's center. Not on pages.",
  },
  opacity: numberValue,
  animation: {
    type: ["object", "null"],
    properties: {
      preset: {
        type: "string",
        enum: [
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
        ],
      },
      delay: { type: "number", description: "ms after playback starts. Default 0." },
      duration: { type: "number", description: "ms. Default 600." },
      easing: { type: "string", enum: ["ease_out", "ease_in_out", "linear", "spring"] },
      countUp: { type: "boolean", description: "Text only: numbers count up from 0." },
    },
    required: ["preset"],
    description:
      "Entrance played in preview and exports (the canvas shows the end state). Stagger siblings with delay. Not on pages.",
  },
  reusable: {
    type: "boolean",
    description: "Marks this node as a component that ref nodes instantiate.",
  },
  visible: {
    type: "boolean",
    description: "false hides the layer and its children (not drawn, not exported). Default true.",
  },
  slot: {
    type: "array",
    items: { type: "string" },
    description:
      "Frame inside a component only. Makes it a slot: instances fill it with their own children, ideally with these component ids (may be empty).",
  },
  fill: fillValue,
  stroke: {
    type: "object",
    properties: {
      color: colorValue,
      width: sides("One width or [top, right, bottom, left]; 0 hides a side."),
    },
    required: ["color"],
  },
  effects: {
    type: "array",
    items: { type: "object" },
    description: "Not on group or ref. Shadows and layer blur (see node format).",
  },
  cornerRadius: numberValue,
  clip: { type: "boolean" },
  layout: { enum: ["none", "horizontal", "vertical"] },
  gap: numberValue,
  padding: sides("Frame only. One value, or [top, right, bottom, left]."),
  justifyContent: { enum: ["start", "center", "end", "space_between", "space_around"] },
  alignItems: { enum: ["start", "center", "end"] },
  geometry: { type: "string", description: "Path only. SVG path data." },
  strokeCap: {
    type: "string",
    enum: ["butt", "round", "square"],
    description: "Path only. Line end shape.",
  },
  strokeJoin: {
    type: "string",
    enum: ["miter", "round", "bevel"],
    description: "Path only. Corner shape.",
  },
  startMarker: {
    type: "string",
    enum: MARKERS,
    description: "Path only. Decoration at the path start.",
  },
  endMarker: {
    type: "string",
    enum: MARKERS,
    description: "Path only. Decoration at the path end.",
  },
  src: {
    type: "string",
    description:
      "Image only. A data: URL (embedded) or an https URL. Existing images are shown as a placeholder; do not invent base64.",
  },
  fit: {
    type: "string",
    enum: ["fill", "fit", "crop", "tile"],
    description:
      "Image only. fill covers the box, fit contains, crop is natural size, tile repeats.",
  },
  alt: { type: "string", description: "Image only. Alt text." },
  source: {
    type: "object",
    description:
      'Image only. Where a browser screenshot came from: {"url": "http(s)://...", "selector"?}. Set by the browser tools; used to refresh it.',
  },
  viewBox: {
    type: "array",
    items: { type: "number" },
    description: "Path only. [minX, minY, width, height]; scales the path to the node size.",
  },
  content: { type: "string", description: "Text only. The text, or a $variable reference." },
  fontFamily: { type: "string", description: "Text only." },
  fontSize: numberValue,
  fontWeight: numberValue,
  fontStyle: { enum: ["normal", "italic"], description: "Text only." },
  lineHeight: { ...numberValue, description: "Text only. Multiple of font size." },
  letterSpacing: { ...numberValue, description: "Text only. px." },
  textAlign: { enum: ["left", "center", "right"] },
  iconSet: { type: "string", description: "Icon only. Defaults to lucide." },
  iconName: { type: "string", description: "Icon only. Icon name in the set, e.g. arrow-right." },
  ref: { type: "string", description: "Ref only. Id of the reusable node to instantiate." },
  descendants: {
    type: "object",
    description:
      'Ref only. Overrides keyed by the component\'s descendant id, e.g. {"label": {"content": "Buy"}}. To fill a slot frame use {"slotId": {"children": [nodes]}}.',
    additionalProperties: { type: "object" },
  },
};

export const NODE_FORMAT_DESCRIPTION =
  "A node object. `type` is required: frame | group | rectangle | ellipse | path | text | icon | image | ref. " +
  "`id` is optional (assigned when omitted). Only frame and group take `children` (same node format, nested). " +
  "Other fields apply per type: frame (slot, layout, gap, padding, justifyContent, alignItems, cornerRadius, clip, fill, stroke, effects), " +
  "rectangle (cornerRadius, fill, stroke, effects), ellipse (fill, stroke, effects), " +
  "path (geometry, viewBox, strokeCap, strokeJoin, startMarker, endMarker, fill, stroke, effects), " +
  "image (src, fit, cornerRadius, stroke, alt), " +
  "text (content, fontFamily, fontSize, fontWeight, fontStyle, lineHeight, letterSpacing, textAlign, fill, effects), icon (iconName, iconSet, fill, effects), " +
  "ref (ref, descendants). Every node also takes visible (false hides it). Colors are hex or $variable; numbers may be $variable; sizes are pixels, fill_container or fit_content. " +
  'Shape fill may be {"type":"linear","angle":180,"stops":[{"color","position":0..1}, ...]} (angle like CSS: 0 up, 90 right), ' +
  '{"type":"radial","center":[0.5,0.5],"radius":[0.5,0.5],"stops":[...]} or {"type":"image","src":"data:image/...;base64,...","fit":"cover"|"contain"|"stretch"}. ' +
  'stroke: {"color","width"} with width one number or [top,right,bottom,left]. ' +
  'effects: [{"type":"shadow","color","x","y","blur","spread"?,"inner"?:true}, {"type":"blur","radius"}].';

export const nodeJsonSchema: JsonSchema = {
  type: "object",
  description: NODE_FORMAT_DESCRIPTION,
  properties: {
    type: {
      type: "string",
      enum: ["frame", "group", "rectangle", "ellipse", "path", "text", "icon", "image", "ref"],
    },
    id: { type: "string", description: "Optional. Omit to get a generated id." },
    ...nodePropSchemas,
    children: {
      type: "array",
      description: "Frame and group only. Child nodes in the same format.",
      items: { type: "object" },
    },
  },
  required: ["type"],
  additionalProperties: false,
};

/** Partial node props for update_node: every prop may be null to unset it. */
export const propsJsonSchema: JsonSchema = {
  type: "object",
  description:
    "Props to change. Only listed props change; null removes a prop (back to its default). " +
    "id, type and children cannot be changed here.",
  properties: Object.fromEntries(
    Object.entries(nodePropSchemas).map(([key, schema]) => [
      key,
      { anyOf: [schema, { type: "null" }] },
    ]),
  ),
  additionalProperties: false,
};

export const variableJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["color", "number", "string"] },
    value: {
      anyOf: [{ type: "string" }, { type: "number" }],
      description: "Hex color for color, number for number, text for string.",
    },
  },
  required: ["type", "value"],
  additionalProperties: false,
};

export const idJsonSchema = (description: string): JsonSchema => ({
  type: "string",
  minLength: 1,
  description,
});

export const parentIdJsonSchema: JsonSchema = {
  anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
  description:
    "Id of the frame or group to insert into, or null for the top level of the active page.",
};

export const indexJsonSchema: JsonSchema = {
  type: "integer",
  minimum: 0,
  description: "Position among the parent's children. Omit to append at the end.",
};
