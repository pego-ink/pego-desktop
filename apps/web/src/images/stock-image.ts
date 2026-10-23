import { toast } from "sonner";
import type { StockImage } from "@pego/agent";
import { createId, type InsertOp, type PegoNode } from "@pego/doc";
import { screenToDoc } from "@/canvas/types";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/** Drag payload of a photo from the Assets panel's image search. */
export const STOCK_IMAGE_MIME = "application/x-pego-stock-image";

/** Drag payload of an image generated in the Assets panel ({src, prompt, width, height}). */
export const GENERATED_IMAGE_MIME = "application/x-pego-generated-image";

/** Longest side of a placed photo, in canvas px (the user resizes it from there). */
const PLACED_SIZE = 480;

/** Openverse's image proxy: the only source a dropped photo may come from. */
const PROXY = /^https:\/\/api\.openverse\.org\/v1\/images\/[\w-]+\/thumb\/(\?full_size=true)?$/;

/** The line that credits a photo, kept as the layer's alt text. */
export const creditLine = (image: Pick<StockImage, "title" | "creator" | "license" | "provider">) =>
  `${image.title}${image.creator ? ` by ${image.creator}` : ""} (${image.license}, via ${image.provider})`;

/** The photo's box: its aspect ratio, PLACED_SIZE on the longer side (4:3 when unknown). */
export const stockImageBox = (image: Pick<StockImage, "width" | "height">) => {
  const width = image.width ?? 4;
  const height = image.height ?? 3;
  const scale = PLACED_SIZE / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

type ImageLayer = { src: string; name: string; alt: string; source?: { url: string } };

/** An image layer centered on `at`, `PLACED_SIZE` on its longer side with the given aspect. */
export const imageLayerNode = (
  layer: ImageLayer,
  aspect: { width?: number; height?: number },
  at: { x: number; y: number },
  id = createId(),
): Extract<PegoNode, { type: "image" }> => {
  const box = stockImageBox(aspect);
  return {
    type: "image",
    id,
    name: layer.name.slice(0, 120),
    src: layer.src,
    fit: "fill",
    alt: layer.alt.slice(0, 500),
    ...(layer.source ? { source: layer.source } : {}),
    x: Math.round(at.x - box.width / 2),
    y: Math.round(at.y - box.height / 2),
    width: box.width,
    height: box.height,
  };
};

/** A found photo's layer: credited in alt, its page as source. */
export const stockImageNode = (
  image: StockImage,
  at: { x: number; y: number },
  id = createId(),
): Extract<PegoNode, { type: "image" }> =>
  imageLayerNode(
    { src: image.src, name: image.title, alt: creditLine(image), source: { url: image.pageUrl } },
    image,
    at,
    id,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A dragged photo, validated: a drop can come from anywhere, so only Openverse proxy images with
 * an https page are accepted. Null otherwise.
 */
export const readDroppedStockImage = (data: string): StockImage | null => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { src, thumb, title, creator, license, pageUrl, width, height } = value;
  if (typeof src !== "string" || !PROXY.test(src)) return null;
  if (typeof thumb !== "string" || !PROXY.test(thumb)) return null;
  if (typeof pageUrl !== "string" || !/^https:\/\//i.test(pageUrl)) return null;
  if (typeof title !== "string" || typeof license !== "string") return null;
  const size =
    typeof width === "number" && typeof height === "number" && width > 0 && height > 0
      ? { width, height }
      : {};
  return {
    src,
    thumb,
    title: title.slice(0, 200),
    ...(typeof creator === "string" ? { creator: creator.slice(0, 120) } : {}),
    license: license.slice(0, 60),
    pageUrl,
    provider: "Openverse",
    ...size,
  };
};

/** Data URLs of generated images that may be dragged and placed (5 MB like place_image). */
const GENERATED_SRC = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_GENERATED_LENGTH = 7_000_000;

/** A generated image's src, validated (a drop can come from anywhere). Null otherwise. */
export const readGeneratedSrc = (src: string): string | null =>
  src.length <= MAX_GENERATED_LENGTH && GENERATED_SRC.test(src) ? src : null;

/**
 * Put an image layer on the shown page, `PLACED_SIZE` on its longer side with the given aspect:
 * centered on canvas point (x, y) when dropped there, else in the middle of the view. Selected.
 */
export const placeImageLayer = (
  layer: ImageLayer,
  aspect: { width?: number; height?: number },
  screen?: { x: number; y: number },
): boolean => {
  const state = useDocumentStore.getState();
  const { camera, size } = useViewportStore.getState();
  const point = screen ?? { x: size.width / 2, y: size.height / 2 };
  const node = imageLayerNode(layer, aspect, screenToDoc(camera, point.x, point.y));
  const op: InsertOp = { op: "insert", parentId: activePage(state).id, node };
  if (!state.commit([op], { label: `Place ${node.name}` })) return false;
  useDocumentStore.getState().select([node.id]);
  return true;
};

/** Put a found photo on the shown page (see `placeImageLayer`), crediting it. */
export const placeStockImage = (image: StockImage, screen?: { x: number; y: number }): boolean => {
  const alt = creditLine(image);
  const placed = placeImageLayer(
    { src: image.src, name: image.title, alt, source: { url: image.pageUrl } },
    image,
    screen,
  );
  if (placed) toast(`Placed ${image.title}`, { description: alt });
  return placed;
};

/** A dragged generated image, validated (a drop can come from anywhere). Null otherwise. */
export const readDroppedGeneratedImage = (
  data: string,
): { src: string; prompt: string; width: number; height: number } | null => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.src !== "string") return null;
  const src = readGeneratedSrc(value.src);
  if (!src) return null;
  const size = (n: unknown) => (typeof n === "number" && n > 0 && n <= 10000 ? n : 1024);
  return {
    src,
    prompt: typeof value.prompt === "string" ? value.prompt.slice(0, 500) : "Generated image",
    width: size(value.width),
    height: size(value.height),
  };
};
