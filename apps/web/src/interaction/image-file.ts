import { toast } from "sonner";
import {
  createId,
  findNode,
  isContainer,
  type Box,
  type Layout,
  type PegoDocument,
  type PegoNode,
} from "@pego/doc";
import { getLayout } from "@/canvas/layout";
import { hitPath } from "@/interaction/hit-test";
import { resolvePlacement, toParentSpace, uniqueName } from "@/interaction/create-node";
import { useDocumentStore } from "@/store/use-document-store";
import { useToolStore } from "@/store/use-tool-store";

/** Longest side of an embedded bitmap; larger images are re-encoded smaller. */
export const MAX_EMBED_SIDE = 2560;
/** Longest side of an image placed by click/paste/drop (not dragged). */
export const MAX_PLACE_SIDE = 800;
/** Above this many bytes a toast warns that the .pego file will get heavy. */
export const WARN_BYTES = 5 * 1024 * 1024;

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const SUPPORTED = new Set(IMAGE_ACCEPT.split(","));

export type Size = { width: number; height: number };

export const isSupportedImage = (file: Pick<File, "type">): boolean => SUPPORTED.has(file.type);

/** `size` shrunk (never enlarged) so its longest side is at most `max`; whole pixels, >= 1. */
export const scaleDownToFit = (size: Size, max: number): Size => {
  const longest = Math.max(size.width, size.height);
  if (longest <= max || longest <= 0) {
    return {
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height)),
    };
  }
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
};

export type ImageAsset = { src: string; width: number; height: number; name: string };

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(blob);
  });

const baseName = (file: File): string => {
  const name = file.name.replace(/\.[^.]+$/, "").trim();
  return name || "Image";
};

const warnIfHeavy = (bytes: number, name: string) => {
  if (bytes <= WARN_BYTES) return;
  toast.warning(
    `${name} is ${(bytes / (1024 * 1024)).toFixed(1)} MB. Large images make the .pego file heavy.`,
  );
};

/** Natural size of an SVG via an img element (0 sizes fall back to 512). */
const svgSize = async (blob: Blob): Promise<Size> => {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      width: img.naturalWidth > 0 ? img.naturalWidth : 512,
      height: img.naturalHeight > 0 ? img.naturalHeight : 512,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Re-encode a bitmap at `target` size as webp (keeps alpha), falling back to the source blob. */
const reencode = async (bitmap: ImageBitmap, target: Size, fallback: Blob): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallback;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );
  return blob && blob.type === "image/webp" ? blob : fallback;
};

/**
 * Read an image file into an embeddable data URL plus its (post-downscale) pixel size.
 * Bitmaps wider than MAX_EMBED_SIDE are re-encoded smaller. Returns null (with a toast) for
 * unsupported or unreadable files.
 */
export const readImageFile = async (file: File): Promise<ImageAsset | null> => {
  if (!isSupportedImage(file)) {
    toast.error(`${file.name || "File"} is not a supported image (png, jpg, webp, gif, svg)`);
    return null;
  }
  const name = baseName(file);
  try {
    if (file.type === "image/svg+xml") {
      const size = await svgSize(file);
      warnIfHeavy(file.size, name);
      return { src: await readAsDataUrl(file), ...size, name };
    }
    const bitmap = await createImageBitmap(file);
    try {
      const natural = { width: bitmap.width, height: bitmap.height };
      const target = scaleDownToFit(natural, MAX_EMBED_SIDE);
      const resized = target.width !== natural.width || target.height !== natural.height;
      const blob = resized ? await reencode(bitmap, target, file) : file;
      warnIfHeavy(blob.size, name);
      return {
        src: await readAsDataUrl(blob),
        ...(blob === file ? natural : target),
        name,
      };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    console.warn(error);
    toast.error(`Could not read ${file.name || "image"}`);
    return null;
  }
};

// ---------------------------------------------------------------------------------------------
// File picker: one persistent hidden input, so a pick can be driven programmatically too.

const INPUT_ID = "pego-image-input";

const getInput = (): HTMLInputElement => {
  const existing = document.getElementById(INPUT_ID);
  if (existing instanceof HTMLInputElement) return existing;
  const input = document.createElement("input");
  input.id = INPUT_ID;
  input.type = "file";
  input.accept = IMAGE_ACCEPT;
  input.hidden = true;
  document.body.appendChild(input);
  return input;
};

/** Open the OS file picker for one image. Resolves null on cancel. Call from a user gesture. */
export const pickImageFile = (): Promise<File | null> =>
  new Promise((resolve) => {
    const input = getInput();
    input.value = "";
    const done = (file: File | null) => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      resolve(file);
    };
    const onChange = () => done(input.files?.[0] ?? null);
    const onCancel = () => done(null);
    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    input.click();
  });

// ---------------------------------------------------------------------------------------------
// Insertion

/** Placement size for an image dropped without dragging: natural, longest side <= MAX_PLACE_SIDE. */
export const placementSize = (natural: Size): Size => scaleDownToFit(natural, MAX_PLACE_SIDE);

const siblingsOf = (doc: PegoDocument, parentId: string | null): readonly PegoNode[] => {
  if (parentId === null) return doc.children;
  const parent = findNode(doc, parentId);
  return parent && isContainer(parent) ? parent.children : [];
};

export type ImagePlacement = ReturnType<typeof resolvePlacement>;

/** Placement of a new node under the doc point (deepest frame there, or the shown page). */
export const placementAt = (
  doc: PegoDocument,
  layout: Layout,
  point: { x: number; y: number },
  pageId: string | null = null,
) => resolvePlacement(doc, layout, hitPath(doc, layout, point.x, point.y, { pageId }), pageId);

/** Image node for `data`, top-left at doc box `box` (relative to the placement's parent). */
export const buildImageNode = (
  doc: PegoDocument,
  data: ImageAsset,
  placement: ImagePlacement,
  box: Box,
): PegoNode =>
  ({
    type: "image",
    id: createId(),
    name: uniqueName(data.name, siblingsOf(doc, placement.parentId)),
    src: data.src,
    fit: "fill",
    width: box.width,
    height: box.height,
    x: 0,
    y: 0,
    ...(placement.flex ? {} : toParentSpace(placement, box.x, box.y)),
  }) as PegoNode;

/** Insert an image with its center at `center` (doc coords) at placement size. Selects it. */
export const insertImageCentered = (data: ImageAsset, center: { x: number; y: number }): void => {
  const store = useDocumentStore.getState();
  const layout = getLayout(store.doc);
  const size = placementSize(data);
  const placement = placementAt(store.doc, layout, center, store.pageId);
  const node = buildImageNode(store.doc, data, placement, {
    x: Math.round(center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2),
    ...size,
  });
  const ok = store.commit([{ op: "insert", parentId: placement.parentId, node }], {
    label: "Place image",
  });
  if (!ok) return;
  store.select([node.id]);
  useToolStore.getState().setTool("select");
};
