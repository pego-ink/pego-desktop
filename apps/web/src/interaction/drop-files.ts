import { toast } from "sonner";
import { screenToDoc } from "@/canvas/types";
import { insertImageCentered, isSupportedImage, readImageFile } from "@/interaction/image-file";
import { openDroppedFile } from "@/persistence/file-actions";
import { useViewportStore } from "@/store/use-viewport-store";

/** Offset between several images dropped at once, in canvas units. */
const STAGGER = 24;

export type DropKind = "document" | "image" | null;

/** What a dropped file becomes: a document to open, an image layer, or nothing. */
export const dropKindOf = (file: { name: string; type: string }): DropKind => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pego") || name.endsWith(".pen")) return "document";
  if (isSupportedImage(file)) return "image";
  return null;
};

/**
 * Handle files dropped on the canvas at screen point (sx, sy), relative to the canvas element.
 * The first .pego/.pen file opens as the document; images become image layers at the pointer.
 */
export const dropFiles = async (files: readonly File[], sx: number, sy: number) => {
  const documentFile = files.find((file) => dropKindOf(file) === "document");
  if (documentFile) return openDroppedFile(documentFile);
  const images = files.filter((file) => dropKindOf(file) === "image");
  if (images.length === 0) {
    toast.error("Drop a .pego or .pen file, or a PNG, JPEG, WebP, GIF or SVG image.");
    return;
  }
  const point = screenToDoc(useViewportStore.getState().camera, sx, sy);
  for (const [i, image] of images.entries()) {
    try {
      const asset = await readImageFile(image);
      if (asset) insertImageCentered(asset, { x: point.x + i * STAGGER, y: point.y + i * STAGGER });
    } catch (error) {
      toast.error(
        `Could not add ${image.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
};
