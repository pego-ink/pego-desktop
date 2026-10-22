import { toast } from "sonner";
import { createId, findNode, isContainer, type PegoNode } from "@pego/doc";
import { screenToDoc } from "@/canvas/types";
import { getLayout } from "@/canvas/layout";
import { hitPath } from "@/interaction/hit-test";
import { resolvePlacement, toParentSpace, uniqueName } from "@/interaction/create-node";
import { imageFileToDataUri } from "@/panels/properties/image-file";
import { openDroppedFile } from "@/persistence/file-actions";
import { useDocumentStore } from "@/store/use-document-store";
import { useViewportStore } from "@/store/use-viewport-store";

/** Dropped images larger than this (on the long side, in canvas units) are scaled down. */
export const MAX_DROPPED_IMAGE_SIDE = 800;

export type DropKind = "document" | "image" | null;

/** What a dropped file becomes: a document to open, an image layer, or nothing. */
export const dropKindOf = (file: { name: string; type: string }): DropKind => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pego") || name.endsWith(".pen")) return "document";
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return "image";
  return null;
};

/** Size on the canvas for an image of `width` x `height`, at most MAX_DROPPED_IMAGE_SIDE long. */
export const droppedImageSize = (width: number, height: number) => {
  const scale = Math.min(1, MAX_DROPPED_IMAGE_SIDE / Math.max(width, height, 1));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

const childrenOf = (parentId: string | null): PegoNode[] => {
  if (parentId === null) return [];
  const parent = findNode(useDocumentStore.getState().doc, parentId);
  return parent && isContainer(parent) ? parent.children : [];
};

/** Add an image as a rectangle with an image fill, centered on the drop point (screen coords). */
const insertImage = async (file: File, sx: number, sy: number) => {
  const [src, bitmap] = await Promise.all([imageFileToDataUri(file), createImageBitmap(file)]);
  const size = droppedImageSize(bitmap.width, bitmap.height);
  bitmap.close();
  const { doc, commit, select, pageId } = useDocumentStore.getState();
  const point = screenToDoc(useViewportStore.getState().camera, sx, sy);
  const layout = getLayout(doc);
  const placement = resolvePlacement(
    doc,
    layout,
    hitPath(doc, layout, point.x, point.y, pageId),
    pageId,
  );
  const id = createId();
  const name = uniqueName(
    file.name.replace(/\.[^.]+$/, "") || "Image",
    childrenOf(placement.parentId),
  );
  const position = placement.flex
    ? {}
    : toParentSpace(placement, point.x - size.width / 2, point.y - size.height / 2);
  commit(
    [
      {
        op: "insert",
        parentId: placement.parentId,
        node: {
          type: "rectangle",
          id,
          name,
          x: 0,
          y: 0,
          ...position,
          ...size,
          fill: { type: "image", src, fit: "cover" },
        },
      },
    ],
    { label: "Add image" },
  );
  select([id]);
};

/**
 * Handle files dropped on the canvas at screen point (sx, sy), relative to the canvas element.
 * The first .pego/.pen file opens as the document; images become layers.
 */
export const dropFiles = async (files: readonly File[], sx: number, sy: number) => {
  const documentFile = files.find((file) => dropKindOf(file) === "document");
  if (documentFile) return openDroppedFile(documentFile);
  const images = files.filter((file) => dropKindOf(file) === "image");
  if (images.length === 0) {
    toast.error("Drop a .pego or .pen file, or a PNG, JPEG, WebP or GIF image.");
    return;
  }
  for (const [i, image] of images.entries()) {
    try {
      await insertImage(image, sx + i * 24, sy + i * 24);
    } catch (error) {
      toast.error(
        `Could not add ${image.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
};
