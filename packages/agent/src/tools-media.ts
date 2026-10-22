import { z } from "zod";
import { collectDocIds, pageOrFirst, type Op, type PegoNode } from "@pego/doc";
import { ImageSrcError, validateImageSrc } from "./media/image-src";
import { convertSvg, MAX_SVG_BYTES, MAX_SVG_NODES, SvgError } from "./media/svg";
import {
  activePageId,
  assignIds,
  commitOps,
  defineTool,
  fail,
  idTree,
  ok,
  parseNode,
  ToolError,
} from "./tool-kit";
import type { ToolHost, ToolResult, ToolSpec } from "./types";

const MAX_PROMPT_LENGTH = 4000;
const MAX_IMAGE_SIZE = 4096;

const parentId = z.string().min(1).nullable();
const coordinate = z.number().finite();
const size = z.number().finite().positive().max(10000);

const parentIdSchema = {
  anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
  description:
    "Id of the frame/group to insert into, or null (default) for the top level of the active page. Without x/y, top-level insertions land to the right of the page's content.",
};
const xSchema = { type: "number", description: "X inside the parent (pixels)." };
const ySchema = { type: "number", description: "Y inside the parent (pixels)." };

/** Where to put an inserted asset when the caller gave no coordinates. */
export const defaultPosition = (
  host: ToolHost,
  parent: string | null,
  x: number | undefined,
  y: number | undefined,
): { x: number; y: number } => {
  if (x !== undefined || y !== undefined) return { x: x ?? 0, y: y ?? 0 };
  if (parent !== null || !host.getLayout) return { x: 0, y: 0 };
  const layout = host.getLayout();
  // Top level of the active page (parentId null lands there, see commitOps).
  const roots = pageOrFirst(host.getDoc(), activePageId(host)).children;
  const right = roots.reduce((max, node) => {
    const box = layout.get(node.id);
    return box ? Math.max(max, box.x + box.width) : max;
  }, Number.NEGATIVE_INFINITY);
  return { x: Number.isFinite(right) ? Math.round(right + 80) : 0, y: 0 };
};

/** Assign ids, validate against the node schema and insert as ONE op (one undo step). */
export const insertRaw = (
  host: ToolHost,
  raw: Record<string, unknown>,
  parent: string | null,
): { node: PegoNode; ignored: string[] } => {
  const taken = collectDocIds(host.getDoc());
  const { node, ignored } = parseNode(assignIds(raw, taken), "node");
  const op: Op = { op: "insert", parentId: parent, node };
  commitOps(host, [op]);
  return { node, ignored };
};

const withWarnings = (data: Record<string, unknown>, warnings: string[]): ToolResult =>
  ok(warnings.length > 0 ? { ...data, warnings } : data);

// --- insert_svg -----------------------------------------------------------------

const insertSvg = defineTool({
  name: "insert_svg",
  description:
    "Insert SVG markup as EDITABLE vector nodes: a clipped frame (sized by the viewBox) holding rectangle, ellipse, path and text nodes. " +
    "Use it for logos, icons and vector illustrations that you write yourself as SVG, or that the user pastes. Pass the complete <svg ...>...</svg> markup with a viewBox. " +
    "Supported: rect (rx), circle, ellipse, line, polyline, polygon, path (all commands; arcs become curves), text (approximate), g, use, embedded data:image <image>, fill/stroke/stroke-width/opacity/linecap/linejoin as attributes or inline style, transform (translate, scale, rotate, skew, matrix), viewBox scaling. " +
    "Not supported (reported in `warnings`, rendered without them): gradients (first stop color is used), filters, masks, clip paths, markers, dashes, evenodd fill rule, <style> CSS. " +
    `Rejected: scripts, foreignObject, event attributes, external references, DTDs. Max ${MAX_SVG_BYTES / 1024} KB and ${MAX_SVG_NODES} nodes. ` +
    "Use flat colors (hex or named). Do not use it to fake photos; use place_image or generate_image for photographs. " +
    "The result has the created id tree and the final width/height.",
  inputSchema: {
    type: "object",
    properties: {
      svg: { type: "string", description: "Complete SVG markup, starting with <svg." },
      parentId: parentIdSchema,
      x: xSchema,
      y: ySchema,
      width: {
        type: "number",
        description:
          "Target width in pixels (default: the SVG's own width or viewBox width). Height keeps the aspect ratio.",
      },
      name: { type: "string", description: "Layer name for the inserted frame." },
    },
    required: ["svg"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    svg: z.string().min(1),
    parentId: parentId.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: size.optional(),
    name: z.string().min(1).max(200).optional(),
  }),
  inputHint: "Pass {svg: string (complete <svg> markup), parentId?, x?, y?, width?, name?}.",
  run: (input, host) => {
    const parent = input.parentId ?? null;
    let converted;
    try {
      converted = convertSvg(input.svg, { width: input.width, name: input.name });
    } catch (error) {
      if (error instanceof SvgError) {
        throw new ToolError(
          error.code,
          error.message,
          "Fix the SVG and call again. Provide plain <svg viewBox=...> markup without scripts, external links or DTDs.",
        );
      }
      throw error;
    }
    const position = defaultPosition(host, parent, input.x, input.y);
    const { node, ignored } = insertRaw(host, { ...converted.node, ...position }, parent);
    return withWarnings(
      {
        ok: true,
        created: idTree(node),
        width: converted.width,
        height: converted.height,
        nodeCount: converted.nodeCount,
      },
      [...converted.warnings, ...ignored.map((path) => `ignored property ${path}`)],
    );
  },
});

// --- place_image ------------------------------------------------------------------

const fitSchema = z.enum(["fill", "fit", "crop", "tile"]);

const checkedSrc = (src: string): string => {
  try {
    return validateImageSrc(src);
  } catch (error) {
    if (error instanceof ImageSrcError) {
      throw new ToolError(
        "invalid_src",
        error.message,
        "Pass an https URL or a base64 data:image/png|jpeg|gif|webp|avif URL.",
      );
    }
    throw error;
  }
};

const ATTACHMENT_PREFIX = "attachment:";

/** `attachment:<id>` -> the data: URL of an image the user attached; any other src as given. */
const resolveSrc = (host: ToolHost, raw: string): { src: string; name?: string } => {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(ATTACHMENT_PREFIX)) return { src: raw };
  const id = trimmed.slice(ATTACHMENT_PREFIX.length).trim();
  const found = host.getAttachment?.(id);
  if (!found) {
    throw new ToolError(
      "unknown_attachment",
      `No attachment with id "${id}"${host.getAttachment ? "" : " (this editor has no attachments)"}.`,
      "Use an id from the user's request (for example attachment:att-1), or an https URL.",
    );
  }
  return found;
};

const imageSizeProps = (width: number | undefined, height: number | undefined) => ({
  width: width ?? height ?? 400,
  height: height ?? width ?? 300,
});

/** Layer name from a file name: no extension, at most 200 characters. */
const layerName = (fileName: string): string =>
  fileName
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .trim()
    .slice(0, 200) || "Image";

const placeImage = defineTool({
  name: "place_image",
  description:
    "Place a bitmap image (photo, screenshot, raster artwork) from a known source as an image node. " +
    "src is an https URL, a base64 data:image URL (png, jpeg, gif, webp, avif; max 5 MB), or attachment:<id> for an image the user attached to the request (the ids are listed in the request). SVG data URLs are rejected: use insert_svg for vectors. " +
    "Never invent URLs: only use ones the user gave you or that you know exist. If you need a new picture and generate_image is available, use that. Never fake photos with shapes. " +
    "fit: fill (cover the box, default), fit (contain), crop (no scaling), tile. Set width and height; if only one is given the box is square-ish to it. Add alt text.",
  inputSchema: {
    type: "object",
    properties: {
      src: {
        type: "string",
        description: "https URL, data:image/...;base64,... URL, or attachment:<id>.",
      },
      parentId: parentIdSchema,
      x: xSchema,
      y: ySchema,
      width: { type: "number", description: "Box width in pixels (default 400)." },
      height: { type: "number", description: "Box height in pixels (default 300)." },
      fit: {
        type: "string",
        enum: ["fill", "fit", "crop", "tile"],
        description: "Default fill (cover).",
      },
      alt: { type: "string", description: "Alt text describing the image." },
      name: { type: "string", description: "Layer name." },
    },
    required: ["src"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    src: z.string().min(1),
    parentId: parentId.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: size.optional(),
    height: size.optional(),
    fit: fitSchema.optional(),
    alt: z.string().max(500).optional(),
    name: z.string().min(1).max(200).optional(),
  }),
  inputHint:
    "Pass {src: https URL | data:image URL | attachment:<id>, parentId?, x?, y?, width?, height?, fit?, alt?}.",
  run: (input, host) => {
    const parent = input.parentId ?? null;
    const resolved = resolveSrc(host, input.src);
    const src = checkedSrc(resolved.src);
    const { node } = insertRaw(
      host,
      {
        type: "image",
        name: input.name ?? (resolved.name ? layerName(resolved.name) : "Image"),
        src,
        fit: input.fit ?? "fill",
        ...(input.alt ? { alt: input.alt } : {}),
        ...imageSizeProps(input.width, input.height),
        ...defaultPosition(host, parent, input.x, input.y),
      },
      parent,
    );
    return ok({ ok: true, created: idTree(node) });
  },
});

// --- generate_image -----------------------------------------------------------------

const UNSUPPORTED_MESSAGE =
  "Image generation is not available here. Add an OpenAI-compatible provider with an image model in Model settings (for example gpt-image-1 or dall-e-3), then try again.";

const generateImage = defineTool({
  name: "generate_image",
  description:
    "Generate a bitmap image (photo, illustration, texture, hero artwork) from a text prompt with the user's configured image model, and place it as an image node. " +
    "Only available when the user added an OpenAI-compatible provider with an image model; otherwise it returns an `unsupported` error: then say so, and design without the image or ask the user for one (place_image). Never fake photos with shapes. " +
    "Slow and costly: generate only the images you really need, one call each, and describe subject, composition, lighting and mood in the prompt. Do not ask for text or logos inside the image (use text nodes and insert_svg). " +
    `width/height set the box on canvas (up to ${MAX_IMAGE_SIZE}); the model picks the closest size it supports, and the image fills the box (cropped to cover).`,
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "What to draw. Be specific." },
      width: { type: "number", description: "Box width in pixels." },
      height: { type: "number", description: "Box height in pixels." },
      parentId: parentIdSchema,
      x: xSchema,
      y: ySchema,
      style: {
        type: "string",
        description:
          "Optional style direction appended to the prompt (e.g. flat vector illustration, warm film photo).",
      },
      name: { type: "string", description: "Layer name." },
    },
    required: ["prompt", "width", "height"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
    width: z.number().finite().min(64).max(MAX_IMAGE_SIZE),
    height: z.number().finite().min(64).max(MAX_IMAGE_SIZE),
    parentId: parentId.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    style: z.string().max(500).optional(),
    name: z.string().min(1).max(200).optional(),
  }),
  inputHint: "Pass {prompt: string, width: number, height: number, parentId?, x?, y?, style?}.",
  run: async (input, host) => {
    if (!host.generateImage) return fail("unsupported", UNSUPPORTED_MESSAGE);
    const parent = input.parentId ?? null;
    const prompt = input.style ? `${input.prompt}\n\nStyle: ${input.style}` : input.prompt;
    let generated;
    try {
      generated = await host.generateImage({
        prompt,
        width: Math.round(input.width),
        height: Math.round(input.height),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ImageUnsupportedError") {
        return fail("unsupported", error.message);
      }
      throw new ToolError(
        "generation_failed",
        error instanceof Error ? error.message : "image generation failed",
        "Check the provider and image model in Model settings, or continue without the image.",
      );
    }
    // The host's output is untrusted too: same rules as place_image.
    const src = checkedSrc(generated.src);
    const alt = generated.alt ?? input.prompt.slice(0, 200);
    const { node } = insertRaw(
      host,
      {
        type: "image",
        name: input.name ?? "Generated image",
        src,
        fit: "fill",
        alt,
        width: input.width,
        height: input.height,
        ...defaultPosition(host, parent, input.x, input.y),
      },
      parent,
    );
    return ok({ ok: true, created: idTree(node) });
  },
});

/** Media tools: insert_svg, place_image, generate_image. */
export const mediaTools: ToolSpec[] = [insertSvg, placeImage, generateImage];
