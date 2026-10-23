import { fitScale, RASTER_MAX_SIDE } from "@/browser/snapshot-images";
import { imageRefsOf, type FigmaNode } from "./figma-convert";

/**
 * Reading a design from the Figma REST API with the user's personal access token. The token goes
 * only into the X-Figma-Token header of requests to api.figma.com; it is never logged or put in
 * an error message.
 */

const API = "https://api.figma.com/v1";
/** Images larger than this are not embedded (they would bloat the document). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 40;
/** Total size of the embedded data URIs; images past it are skipped with a warning. */
const MAX_TOTAL_CHARS = 25 * 1024 * 1024;
const EMBEDDABLE = /^image\/(png|jpeg|webp|gif)$/;

export type FigmaTarget = { fileKey: string; nodeId?: string };

/**
 * The file and (optional) layer of a Figma link: figma.com/design/<key>/...?node-id=12-34
 * (also /file/, /proto/ and /board/). Null for anything else.
 */
export const parseFigmaUrl = (input: string): FigmaTarget | null => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return null;
  const match = /^\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/.exec(url.pathname);
  if (!match) return null;
  const raw = url.searchParams.get("node-id");
  const nodeId = raw ? raw.replace(/-/g, ":") : undefined;
  return { fileKey: match[1]!, ...(nodeId && /^[\d:;I]+$/.test(nodeId) ? { nodeId } : {}) };
};

export type FigmaImport = {
  /** The file's name, or the layer's. */
  name: string;
  /** The layers to convert: the linked layer, or the top-level layers of its (first) page. */
  nodes: FigmaNode[];
  /** imageRef -> data URI, for the image fills that could be fetched. */
  images: Map<string, string>;
  /** Image fills that could not be embedded. */
  missingImages: number;
  /** Things lost on the way that the user should know about. */
  warnings: string[];
};

type Fetch = typeof fetch;

type Bytes = { bytes: Uint8Array; type: string };
/** Shrinks an image to the embed size; the default needs a browser (createImageBitmap + canvas). */
export type ShrinkImage = (image: Bytes) => Promise<Bytes>;

/** Re-encode as webp when the longest side exceeds 2048 px; anything else is kept as it is. */
export const shrinkImage: ShrinkImage = async (image) => {
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return image;
  const bitmap = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.type }));
  try {
    const scale = fitScale(bitmap.width, bitmap.height, RASTER_MAX_SIDE);
    if (scale >= 1) return image;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return image;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.9),
    );
    if (!blob || blob.type !== "image/webp") return image;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: "image/webp" };
  } finally {
    bitmap.close();
  }
};

const failure = (status: number): Error =>
  new Error(
    status === 403
      ? "Figma refused the token. Check it and that it can read this file."
      : status === 404
        ? "Figma could not find that file or layer (or the token cannot see it)."
        : status === 429
          ? "Figma is rate limiting requests. Wait a minute and try again."
          : `Figma answered with HTTP ${status}.`,
  );

const getJson = async (fetcher: Fetch, path: string, token: string): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetcher(`${API}${path}`, { headers: { "X-Figma-Token": token } });
  } catch {
    throw new Error("Could not reach Figma. Check the connection and try again.");
  }
  if (!response.ok) throw failure(response.status);
  return response.json();
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

/** One image as a data URI, or null when it is too big, not an image Pego embeds, or unreachable. */
const embedImage = async (
  fetcher: Fetch,
  url: string,
  shrink: ShrinkImage,
): Promise<string | null> => {
  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!EMBEDDABLE.test(type)) return null;
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    const shrunk = await shrink({ bytes, type }).catch(() => ({ bytes, type }));
    return `data:${shrunk.type};base64,${toBase64(shrunk.bytes)}`;
  } catch {
    return null;
  }
};

/** The layers to import from a page or a layer of the file. */
const layersOf = (node: FigmaNode): FigmaNode[] =>
  node.type === "CANVAS" || node.type === "DOCUMENT" ? (node.children ?? []) : [node];

/** Fetch the linked layer (or the first page) and embed its images. */
export const fetchFigmaImport = async (
  target: FigmaTarget,
  token: string,
  fetcher: Fetch = fetch,
  shrink: ShrinkImage = shrinkImage,
): Promise<FigmaImport> => {
  let name: string;
  let nodes: FigmaNode[];
  if (target.nodeId) {
    const data = (await getJson(
      fetcher,
      `/files/${target.fileKey}/nodes?ids=${encodeURIComponent(target.nodeId)}&geometry=paths`,
      token,
    )) as { name?: string; nodes?: Record<string, { document?: FigmaNode } | null> };
    const document = data.nodes?.[target.nodeId]?.document;
    if (!document) throw new Error("That layer is not in the file anymore.");
    name = document.name ?? data.name ?? "Figma";
    nodes = layersOf(document);
  } else {
    // Only the first page is used: list the pages shallowly, then fetch just that one.
    const outline = (await getJson(fetcher, `/files/${target.fileKey}?depth=1`, token)) as {
      name?: string;
      document?: FigmaNode;
    };
    const first = outline.document?.children?.[0];
    if (!first) throw new Error("The file has no pages.");
    const data = (await getJson(
      fetcher,
      `/files/${target.fileKey}/nodes?ids=${encodeURIComponent(first.id)}&geometry=paths`,
      token,
    )) as { nodes?: Record<string, { document?: FigmaNode } | null> };
    const page = data.nodes?.[first.id]?.document;
    if (!page) throw new Error("The first page of the file could not be read.");
    name = outline.name ?? page.name ?? "Figma";
    nodes = layersOf(page);
  }

  const refs = [...imageRefsOf(nodes)];
  const images = new Map<string, string>();
  const warnings: string[] = [];
  if (refs.length > 0) {
    const data = (await getJson(fetcher, `/files/${target.fileKey}/images`, token)) as {
      meta?: { images?: Record<string, string> };
    };
    const urls = data.meta?.images ?? {};
    let total = 0;
    for (const ref of refs.slice(0, MAX_IMAGES)) {
      const url = urls[ref];
      const embedded = url ? await embedImage(fetcher, url, shrink) : null;
      if (!embedded) continue;
      if (total + embedded.length > MAX_TOTAL_CHARS) {
        warnings.push("images past the 25 MB embed budget were skipped");
        continue;
      }
      total += embedded.length;
      images.set(ref, embedded);
    }
    if (refs.length > MAX_IMAGES) warnings.push(`only the first ${MAX_IMAGES} images were fetched`);
  }
  return { name, nodes, images, missingImages: refs.length - images.size, warnings };
};
