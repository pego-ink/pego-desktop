import type { JsonSchema } from "./types";

const VARIABLE_PATTERN = "^\\$[A-Za-z_][\\w-]*$";
const COLOR_PATTERN = "^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|\\$[A-Za-z_][\\w-]*)$";

const colorValue: JsonSchema = {
  type: "string",
  pattern: COLOR_PATTERN,
  description: "Hex color (#rgb, #rrggbb, #rrggbbaa) or a $variable reference.",
};
const numberValue: JsonSchema = {
  anyOf: [{ type: "number" }, { type: "string", pattern: VARIABLE_PATTERN }],
  description: "Number or a $variable reference.",
};
const sizing: JsonSchema = {
  anyOf: [{ type: "number" }, { type: "string", enum: ["fill_container", "fit_content"] }],
  description: "Pixels, or fill_container / fit_content.",
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
  opacity: numberValue,
  reusable: {
    type: "boolean",
    description: "Marks this node as a component that ref nodes instantiate.",
  },
  fill: colorValue,
  stroke: {
    type: "object",
    properties: { color: colorValue, width: numberValue },
    required: ["color"],
    additionalProperties: false,
  },
  cornerRadius: numberValue,
  clip: { type: "boolean" },
  layout: { type: "string", enum: ["none", "horizontal", "vertical"], description: "Frame only." },
  gap: numberValue,
  padding: {
    anyOf: [numberValue, { type: "array", items: numberValue, minItems: 4, maxItems: 4 }],
    description: "Frame only. One value, or [top, right, bottom, left].",
  },
  justifyContent: {
    type: "string",
    enum: ["start", "center", "end", "space_between", "space_around"],
    description: "Frame only. Main-axis distribution.",
  },
  alignItems: {
    type: "string",
    enum: ["start", "center", "end"],
    description: "Frame only. Cross-axis alignment.",
  },
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
  content: { type: "string", description: "Text only. The text, or a $variable reference." },
  fontFamily: { type: "string", description: "Text only." },
  fontSize: numberValue,
  fontWeight: numberValue,
  fontStyle: { type: "string", enum: ["normal", "italic"], description: "Text only." },
  textAlign: { type: "string", enum: ["left", "center", "right"], description: "Text only." },
  iconSet: { type: "string", description: "Icon only. Defaults to lucide." },
  iconName: { type: "string", description: "Icon only. Icon name in the set, e.g. arrow-right." },
  ref: { type: "string", description: "Ref only. Id of the reusable node to instantiate." },
  descendants: {
    type: "object",
    description:
      'Ref only. Overrides keyed by the component\'s descendant id, e.g. {"label": {"content": "Buy"}}.',
    additionalProperties: { type: "object" },
  },
};

export const NODE_FORMAT_DESCRIPTION =
  "A node object. `type` is required: frame | group | rectangle | ellipse | path | text | icon | image | ref. " +
  "`id` is optional (assigned when omitted). Only frame and group take `children` (same node format, nested). " +
  "Other fields apply per type: frame (layout, gap, padding, justifyContent, alignItems, cornerRadius, clip, fill, stroke), " +
  "rectangle (cornerRadius, fill, stroke), ellipse (fill, stroke), path (geometry, strokeCap, strokeJoin, startMarker, endMarker, fill, stroke), " +
  "image (src, fit, cornerRadius, stroke, alt), " +
  "text (content, fontFamily, fontSize, fontWeight, fontStyle, textAlign, fill), icon (iconName, iconSet, fill), " +
  "ref (ref, descendants). Colors are hex or $variable; sizes are pixels, fill_container or fit_content.";

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
  description: "Id of the frame or group to insert into, or null for the document root.",
};

export const indexJsonSchema: JsonSchema = {
  type: "integer",
  minimum: 0,
  description: "Position among the parent's children. Omit to append at the end.",
};
