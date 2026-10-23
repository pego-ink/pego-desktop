import { toast } from "sonner";
import type { StockImage } from "@pego/agent";
import { createId, type InsertOp, type PegoNode } from "@pego/doc";
import { screenToDoc } from "@/canvas/types";
import { activePage, useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/** Drag payload of a photo from the Assets panel's image search. */
export const STOCK_IMAGE_MIME = "application/x-pego-stock-image";

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

/** An image layer for `image`, centered on `at`, crediting it in alt and source. */
export const stockImageNode = (
  image: StockImage,
  at: { x: number; y: number },
  id = createId(),
): Extract<PegoNode, { type: "image" }> => {
  const box = stockImageBox(image);
  return {
    type: "image",
    id,
    name: image.title.slice(0, 120),
    src: image.src,
    fit: "fill",
    alt: creditLine(image).slice(0, 500),
    source: { url: image.pageUrl },
    x: Math.round(at.x - box.width / 2),
    y: Math.round(at.y - box.height / 2),
    width: box.width,
    height: box.height,
  };
};

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

/**
 * Put `image` on the shown page: centered on canvas point (x, y) when dropped there, else in the
 * middle of the view. The new layer is selected.
 */
export const placeStockImage = (image: StockImage, screen?: { x: number; y: number }): boolean => {
  const state = useDocumentStore.getState();
  const { camera, size } = useViewportStore.getState();
  const point = screen ?? { x: size.width / 2, y: size.height / 2 };
  const node = stockImageNode(image, screenToDoc(camera, point.x, point.y));
  const op: InsertOp = { op: "insert", parentId: activePage(state).id, node };
  if (!state.commit([op], { label: `Place ${node.name}` })) return false;
  useDocumentStore.getState().select([node.id]);
  toast(`Placed ${node.name}`, { description: node.alt });
  return true;
};
