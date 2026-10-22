import type { Canvas as SkCanvas, CanvasKit, Image as SkImage, Paint } from "canvaskit-wasm";
import { resolveColor, resolveNumber, type ImageNode, type Variables } from "@pego/doc";
import { getIconPath } from "@/canvas/icons";
import type { CanvasKitResources } from "@/canvas/load-canvaskit";
import { createLruCache } from "@/canvas/render-cache";
import { useLayerEvents } from "@/canvas/layer-events";

export type Rect = { left: number; top: number; right: number; bottom: number };
export type ImageFit = NonNullable<ImageNode["fit"]>;
export type FitRects = { src: Rect; dest: Rect };

/**
 * Source and destination rects (image px -> box px) for `fill` (cover), `fit` (contain) and
 * `crop` (natural size, centered, overflow cut). `tile` is drawn with a shader, not rects.
 * Returns null for degenerate sizes.
 */
export const computeFitRects = (
  fit: Exclude<ImageFit, "tile">,
  image: { width: number; height: number },
  box: { width: number; height: number },
): FitRects | null => {
  if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const whole: Rect = { left: 0, top: 0, right: image.width, bottom: image.height };
  const boxRect: Rect = { left: 0, top: 0, right: box.width, bottom: box.height };

  if (fit === "fit") {
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const left = (box.width - w) / 2;
    const top = (box.height - h) / 2;
    return { src: whole, dest: { left, top, right: left + w, bottom: top + h } };
  }

  if (fit === "fill") {
    // Cover: scale so the box is fully covered, then take the centered source window.
    const scale = Math.max(box.width / image.width, box.height / image.height);
    const sw = box.width / scale;
    const sh = box.height / scale;
    const left = (image.width - sw) / 2;
    const top = (image.height - sh) / 2;
    return { src: { left, top, right: left + sw, bottom: top + sh }, dest: boxRect };
  }

  // crop: 1:1, centered. Whichever is smaller per axis decides the visible window.
  const visibleW = Math.min(image.width, box.width);
  const visibleH = Math.min(image.height, box.height);
  const srcLeft = (image.width - visibleW) / 2;
  const srcTop = (image.height - visibleH) / 2;
  const destLeft = (box.width - visibleW) / 2;
  const destTop = (box.height - visibleH) / 2;
  return {
    src: { left: srcLeft, top: srcTop, right: srcLeft + visibleW, bottom: srcTop + visibleH },
    dest: { left: destLeft, top: destTop, right: destLeft + visibleW, bottom: destTop + visibleH },
  };
};

// ---------------------------------------------------------------------------------------------
// Decode cache

/** Bytes to decode plus how many raster px one document unit of natural size is (SVG only). */
export type LoadedBytes = { bytes: Uint8Array; scale: number };
export type LoadBytes = (src: string) => Promise<LoadedBytes>;

export type ImageStatus =
  | { state: "ready"; image: SkImage; width: number; height: number }
  | { state: "loading" }
  | { state: "error" };

const SVG_MAX_RASTER = 2048;
const DATA_URL = /^data:(image\/[a-z0-9.+-]+)?(;[^,]*)?,/i;

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Bytes and mime of a `data:image/...` URL. Throws for anything else. */
export const parseDataUrl = (src: string): { mime: string; bytes: Uint8Array } => {
  const match = DATA_URL.exec(src);
  if (!match?.[1]) throw new Error("not an image data URL");
  const mime = match[1].toLowerCase();
  const payload = src.slice(match[0].length);
  const isBase64 = /;base64/i.test(match[2] ?? "");
  const bytes = isBase64
    ? base64ToBytes(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { mime, bytes };
};

/** SVG is not decodable by CanvasKit: rasterize it with the browser (img element is script-safe). */
const rasterizeSvg = async (bytes: Uint8Array): Promise<LoadedBytes> => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const natural = {
      width: img.naturalWidth > 0 ? img.naturalWidth : 512,
      height: img.naturalHeight > 0 ? img.naturalHeight : 512,
    };
    const scale = Math.min(2, SVG_MAX_RASTER / Math.max(natural.width, natural.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(natural.width * scale));
    canvas.height = Math.max(1, Math.round(natural.height * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("svg rasterization failed");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), scale };
  } finally {
    URL.revokeObjectURL(url);
  }
};

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

/** Default loader: data URLs are decoded locally, https URLs fetched with CORS. Nothing else. */
export const loadImageBytes: LoadBytes = async (src) => {
  if (src.startsWith("data:")) {
    const { mime, bytes } = parseDataUrl(src);
    return mime === "image/svg+xml" ? rasterizeSvg(bytes) : { bytes, scale: 1 };
  }
  if (!/^https:\/\//i.test(src)) throw new Error("unsupported image source");
  const response = await fetch(src, {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`image request failed (${response.status})`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !type.toLowerCase().startsWith("image/")) throw new Error("not an image");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_REMOTE_BYTES) throw new Error("image too large");
  const bytes = new Uint8Array(buffer);
  return /svg/i.test(type) ? rasterizeSvg(bytes) : { bytes, scale: 1 };
};

type DecodeKit = Pick<CanvasKit, "MakeImageFromEncoded">;

/**
 * Decodes each unique `src` once. `get` returns the current status without blocking: a miss
 * starts the decode and reports `loading`; `onChange` fires when it settles. Ready images live
 * in an LRU that deletes evicted images; failures are remembered (bounded) so a bad src is not
 * retried every frame.
 */
export const createImageStore = (options: {
  load?: LoadBytes;
  onChange?: () => void;
  maxImages?: number;
  maxFailures?: number;
}) => {
  const { load = loadImageBytes, onChange = () => {}, maxImages = 48, maxFailures = 64 } = options;
  const images = createLruCache<SkImage>(maxImages);
  const sizes = new Map<string, { width: number; height: number }>();
  const pending = new Set<string>();
  const failed = new Set<string>();

  const start = (kit: DecodeKit, src: string) => {
    pending.add(src);
    void load(src)
      .then(({ bytes, scale }) => {
        const decoded = kit.MakeImageFromEncoded(bytes);
        if (!decoded) throw new Error("could not decode image");
        // Mipmaps keep minified (zoomed-out) images smooth.
        const image = decoded.makeCopyWithDefaultMipmaps();
        decoded.delete();
        sizes.set(src, { width: image.width() / scale, height: image.height() / scale });
        images.set(src, image);
      })
      .catch((error: unknown) => {
        console.warn("image failed to load", error instanceof Error ? error.message : error);
        if (failed.size >= maxFailures) failed.clear();
        failed.add(src);
      })
      .finally(() => {
        pending.delete(src);
        onChange();
      });
  };

  return {
    get: (kit: DecodeKit, src: string): ImageStatus => {
      const image = images.get(src);
      const size = sizes.get(src);
      if (image && size) return { state: "ready", image, ...size };
      if (failed.has(src)) return { state: "error" };
      if (!pending.has(src)) start(kit, src);
      return { state: "loading" };
    },
    /** Natural size in document units once decoded (may be evicted from the LRU, size is kept). */
    sizeOf: (src: string) => sizes.get(src),
  };
};

const store = createImageStore({ onChange: () => useLayerEvents.getState().invalidate() });

/** Natural size of a decoded image, or undefined while loading / on error. */
export const getImageNaturalSize = (src: string) => store.sizeOf(src);

// ---------------------------------------------------------------------------------------------
// Drawing

type ImagePaints = { image: Paint; fill: Paint; stroke: Paint; icon: Paint };
const paintsByKit = new WeakMap<CanvasKit, ImagePaints>();

const getPaints = (ck: CanvasKit): ImagePaints => {
  const cached = paintsByKit.get(ck);
  if (cached) return cached;
  const make = (style: "fill" | "stroke") => {
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(style === "fill" ? ck.PaintStyle.Fill : ck.PaintStyle.Stroke);
    return paint;
  };
  const icon = make("stroke");
  icon.setStrokeCap(ck.StrokeCap.Round);
  icon.setStrokeJoin(ck.StrokeJoin.Round);
  icon.setStrokeWidth(2);
  const paints = { image: make("fill"), fill: make("fill"), stroke: make("stroke"), icon };
  paintsByKit.set(ck, paints);
  return paints;
};

const CHECK_SIZE = 8;
const PLACEHOLDER_A = "#2A2A31";
const PLACEHOLDER_B = "#33333B";

const drawPlaceholder = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  width: number,
  height: number,
  failedToLoad: boolean,
) => {
  const { ck } = res;
  const paints = getPaints(ck);
  paints.fill.setColor(ck.parseColorString(PLACEHOLDER_A));
  canvas.drawRect(ck.XYWHRect(0, 0, width, height), paints.fill);
  paints.fill.setColor(ck.parseColorString(PLACEHOLDER_B));
  // Cap the tile count so a huge placeholder stays cheap.
  const step = Math.max(CHECK_SIZE, Math.ceil(Math.max(width, height) / 64));
  for (let y = 0, row = 0; y < height; y += step, row++) {
    for (let x = (row % 2) * step; x < width; x += step * 2) {
      canvas.drawRect(
        ck.LTRBRect(x, y, Math.min(x + step, width), Math.min(y + step, height)),
        paints.fill,
      );
    }
  }
  const icon = getIconPath(ck, failedToLoad ? "image-off" : "image");
  const size = Math.min(width, height, 48) * 0.6;
  if (!icon || size < 8) return;
  paints.icon.setColor(ck.parseColorString(failedToLoad ? "#F87171" : "#9A9AA6"));
  paints.icon.setStrokeWidth(2);
  canvas.save();
  canvas.translate((width - size) / 2, (height - size) / 2);
  canvas.scale(size / 24, size / 24);
  canvas.drawPath(icon, paints.icon);
  canvas.restore();
};

const drawTiled = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  image: SkImage,
  size: { width: number; height: number },
  box: { width: number; height: number },
) => {
  const { ck } = res;
  const paints = getPaints(ck);
  // Tiles are drawn at natural (document-unit) size.
  const sx = size.width / image.width();
  const sy = size.height / image.height();
  const shader = image.makeShaderOptions(
    ck.TileMode.Repeat,
    ck.TileMode.Repeat,
    ck.FilterMode.Linear,
    ck.MipmapMode.Linear,
    ck.Matrix.scaled(sx, sy),
  );
  paints.image.setShader(shader);
  canvas.drawRect(ck.XYWHRect(0, 0, box.width, box.height), paints.image);
  paints.image.setShader(null);
  shader.delete();
};

/**
 * Draw an image node in its local space (origin = box top-left): image per `fit` clipped to
 * the (rounded) box, then the optional stroke. Placeholder while loading or on error.
 */
export const drawImageNode = (
  res: CanvasKitResources,
  canvas: SkCanvas,
  node: ImageNode,
  box: { width: number; height: number },
  variables: Variables,
): void => {
  const { ck } = res;
  const { width, height } = box;
  if (width <= 0 || height <= 0) return;
  const radius = Math.max(0, resolveNumber(node.cornerRadius, variables, 0));
  const rrect = ck.RRectXY(ck.XYWHRect(0, 0, width, height), radius, radius);
  const paints = getPaints(ck);
  const status = store.get(ck, node.src);

  canvas.save();
  canvas.clipRRect(rrect, ck.ClipOp.Intersect, true);
  if (status.state !== "ready") {
    drawPlaceholder(res, canvas, width, height, status.state === "error");
  } else if (node.fit === "tile") {
    drawTiled(res, canvas, status.image, status, box);
  } else {
    const rects = computeFitRects(
      node.fit ?? "fill",
      { width: status.image.width(), height: status.image.height() },
      box,
    );
    if (rects) {
      const { src, dest } = rects;
      canvas.drawImageRectOptions(
        status.image,
        ck.LTRBRect(src.left, src.top, src.right, src.bottom),
        ck.LTRBRect(dest.left, dest.top, dest.right, dest.bottom),
        ck.FilterMode.Linear,
        ck.MipmapMode.Linear,
        paints.image,
      );
    }
  }
  canvas.restore();

  if (!node.stroke) return;
  const color = resolveColor(node.stroke.color, variables);
  const strokeWidth = resolveNumber(node.stroke.width, variables, 1);
  if (!color || strokeWidth <= 0) return;
  paints.stroke.setColor(ck.parseColorString(color));
  paints.stroke.setStrokeWidth(strokeWidth);
  canvas.drawRRect(rrect, paints.stroke);
};
