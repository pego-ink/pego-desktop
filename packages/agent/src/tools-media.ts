import { z } from "zod";
import { collectDocIds, findNode, pageOrFirst, type Op, type PegoNode } from "@pego/doc";
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

/**
 * SVG markup as one Pego node (a group of vector nodes) with ids that are not in `taken`.
 * Pasting and dropping SVG on the canvas use it too; `width` scales it (height keeps the aspect).
 * Throws `SvgError` for markup it cannot convert.
 */
export const svgToNode = (
  source: string,
  taken: Set<string>,
  name?: string,
  width?: number,
): PegoNode =>
  parseNode(
    assignIds(
      convertSvg(source, { ...(name ? { name } : {}), ...(width ? { width } : {}) }).node,
      taken,
    ),
    "node",
  ).node;

const withWarnings = (data: Record<string, unknown>, warnings: string[]): ToolResult =>
  ok(warnings.length > 0 ? { ...data, warnings } : data);

// --- insert_svg -----------------------------------------------------------------

const insertSvg = defineTool({
  name: "insert_svg",
  description:
    "Insert SVG markup as EDITABLE vector nodes: a group (sized by the viewBox, content outside it is not clipped) holding rectangle, ellipse, path and text nodes; resizing the group scales everything in it. " +
    "Use it for logos, icons and vector illustrations that you write yourself as SVG, or that the user pastes. Pass the complete <svg ...>...</svg> markup with a viewBox. " +
    "Supported: rect (rx), circle, ellipse, line, polyline, polygon, path (all commands; arcs become curves), text (approximate), g, use, embedded data:image <image>, fill/stroke/stroke-width/opacity/linecap/linejoin as attributes or inline style, transform (translate, scale, rotate, skew, matrix), viewBox scaling (nested <svg> too), linear and radial gradient fills (on text and strokes the first stop color is used). " +
    "Not supported (reported in `warnings`, rendered without them): filters, masks, clip paths, markers, dashes, evenodd fill rule, <style> CSS. " +
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
      name: { type: "string", description: "Layer name for the inserted group." },
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

/**
 * A web image downloaded into the file when the host can (most sites do not let the canvas load
 * their images directly, and an embedded image also works offline); other sources as they are.
 */
const embedded = async (host: ToolHost, src: string): Promise<string> => {
  if (!host.fetchImage || !/^https:\/\//i.test(src)) return src;
  let data: string;
  try {
    data = await host.fetchImage(src);
  } catch (error) {
    throw new ToolError(
      "image_unavailable",
      `Could not download the image from ${new URL(src).hostname}: ${error instanceof Error ? error.message : String(error)}`,
      "Pick another image (another result, or search_images).",
    );
  }
  return checkedSrc(data);
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
    "Never invent URLs: only use ones the user gave you, that search_images or browser search-images / find-images returned, or that you know exist. https images are downloaded and embedded in the file. For a real photo, search_images first; if you need an invented picture and generate_image is available, use that. Never fake photos with shapes. " +
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
      sourceUrl: {
        type: "string",
        description:
          "The image's page (search_images: pageUrl; browser images: pageUrl or the results page), kept on the layer for credit and license.",
      },
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
    sourceUrl: z
      .string()
      .max(2000)
      .regex(/^https:\/\//i, "must be an https URL")
      .optional(),
  }),
  inputHint:
    "Pass {src: https URL | data:image URL | attachment:<id>, parentId?, x?, y?, width?, height?, fit?, alt?, sourceUrl?}.",
  run: async (input, host) => {
    const parent = input.parentId ?? null;
    const resolved = resolveSrc(host, input.src);
    const src = await embedded(host, checkedSrc(resolved.src));
    const { node } = insertRaw(
      host,
      {
        type: "image",
        name: input.name ?? (resolved.name ? layerName(resolved.name) : "Image"),
        src,
        fit: input.fit ?? "fill",
        ...(input.alt ? { alt: input.alt } : {}),
        ...(input.sourceUrl ? { source: { url: input.sourceUrl } } : {}),
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

// --- search_images ------------------------------------------------------------------

const MAX_SEARCH_RESULTS = 20;

const searchImages = defineTool({
  name: "search_images",
  description:
    "Search photos for a query, e.g. 'fried chicken on a plate' or 'mountain lake at dawn', with the user's image search: in the desktop app Google Images through Pego's built-in browser by default (provider \"Google Images\", license unknown: web pictures, usually copyrighted), otherwise openly licensed free photos (provider \"Openverse\"); it falls back to Openverse when Google is not available. " +
    "Returns candidates with src, size, title, creator, license and pageUrl. Then place the one you want with place_image: pass its src, a box that keeps its aspect ratio, alt, and sourceUrl = pageUrl so the credit stays on the layer. " +
    "Use it for real photos (food, places, people, products); use generate_image only for pictures that cannot exist. Search with concrete nouns (in the user's language works for Google, English is best for Openverse). Tell the user which photos you used, where they came from and, for Openverse, their credit line. Each result's provider says which source answered.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the photo shows." },
      count: {
        type: "number",
        description: `How many candidates (1-${MAX_SEARCH_RESULTS}, default 6).`,
      },
      orientation: {
        type: "string",
        enum: ["landscape", "portrait", "square"],
        description: "Optional shape to prefer.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    query: z.string().trim().min(1).max(200),
    count: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
    orientation: z.enum(["landscape", "portrait", "square"]).optional(),
  }),
  inputHint: "Pass {query: string, count?: number, orientation?: 'landscape'|'portrait'|'square'}.",
  run: async (input, host) => {
    if (!host.searchImages) {
      return fail("unsupported", "Image search is not available in this editor.");
    }
    let found;
    try {
      found = await host.searchImages({
        query: input.query,
        count: input.count ?? 6,
        ...(input.orientation ? { orientation: input.orientation } : {}),
      });
    } catch (error) {
      throw new ToolError(
        "search_failed",
        error instanceof Error ? error.message : "image search failed",
        "Try again, try other words, or design without the photo.",
      );
    }
    // Results come from the network: keep only ones place_image would accept.
    const results = found.flatMap((image) => {
      try {
        return [{ ...image, src: checkedSrc(image.src) }];
      } catch {
        return [];
      }
    });
    return ok({
      query: input.query,
      results: results.map((image) => ({
        src: image.src,
        ...(image.width && image.height ? { width: image.width, height: image.height } : {}),
        title: image.title,
        ...(image.creator ? { creator: image.creator } : {}),
        license: image.license,
        pageUrl: image.pageUrl,
        credit: `${image.title}${image.creator ? ` by ${image.creator}` : ""} (${image.license}, via ${image.provider})`,
      })),
      ...(results.length === 0 ? { hint: "No photo found; try broader or other words." } : {}),
    });
  },
});

/** Media tools: insert_svg, place_image, generate_image, search_images. */
// --- remove_background ----------------------------------------------------------------

const removeBackground = defineTool({
  name: "remove_background",
  description:
    "Cut the subject out of a photo: removes the background of an image layer, or of the image fill of a frame, rectangle, ellipse or path, leaving transparency (one undo step). " +
    'quality "standard" (default) runs on the user\'s device (a one-time 44 MB model download); "high" uses the user\'s gpt-image model when one is set up, and costs them a request. ' +
    "Use it for product shots, people, animals or food that should sit on a new background; check the result with get_screenshot.",
  inputSchema: {
    type: "object",
    properties: {
      nodeId: { type: "string", description: "The image layer, or a shape with an image fill." },
      quality: {
        type: "string",
        enum: ["standard", "high"],
        description: 'Default "standard" (on device).',
      },
    },
    required: ["nodeId"],
    additionalProperties: false,
  },
  schema: z.strictObject({
    nodeId: z.string().min(1),
    quality: z.enum(["standard", "high"]).optional(),
  }),
  inputHint: 'Pass {nodeId, quality?: "standard" | "high"}.',
  run: async (input, host) => {
    if (!host.removeBackground) {
      return fail("unsupported", "Background removal is not available in this editor.");
    }
    const node = findNode(host.getDoc(), input.nodeId);
    if (!node) {
      throw new ToolError(
        "node_not_found",
        `No node with id "${input.nodeId}"`,
        "Use an id from get_document.",
      );
    }
    const fill =
      "fill" in node && typeof node.fill === "object" && node.fill?.type === "image"
        ? node.fill
        : null;
    const src = node.type === "image" ? node.src : fill?.src;
    if (!src) {
      throw new ToolError(
        "no_image",
        `${node.name ?? node.id} has no image`,
        "Pass an image layer, or a shape whose fill is an image.",
      );
    }
    const quality = input.quality ?? "standard";
    let cut: string;
    try {
      cut = checkedSrc(await host.removeBackground(src, { quality }));
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "removal_failed",
        error instanceof Error ? error.message : String(error),
        quality === "high" ? 'Try quality "standard" (on device).' : undefined,
      );
    }
    commitOps(host, [
      {
        op: "update",
        id: node.id,
        props: node.type === "image" ? { src: cut } : { fill: { ...fill!, src: cut } },
      },
    ]);
    return ok({ ok: true, updated: node.id, quality });
  },
});

export const mediaTools: ToolSpec[] = [
  insertSvg,
  placeImage,
  generateImage,
  searchImages,
  removeBackground,
];
