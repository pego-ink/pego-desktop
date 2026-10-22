import { useEffect } from "react";
import { screenToDoc } from "@/canvas/types";
import { insertImageCentered, isSupportedImage, readImageFile } from "@/interaction/image-file";
import { useViewportStore } from "@/store/use-viewport-store";

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");

/** Place each image file around a doc point (staggered slightly when several arrive at once). */
const placeFiles = async (files: readonly File[], point: { x: number; y: number }) => {
  let offset = 0;
  for (const file of files) {
    const asset = await readImageFile(file);
    if (!asset) continue;
    insertImageCentered(asset, { x: point.x + offset, y: point.y + offset });
    offset += 24;
  }
};

/**
 * Clipboard paste of image files onto the canvas, at the viewport center. Drops are handled by
 * the canvas container (`dropFiles`), which also opens .pego/.pen files.
 */
export const useImagePaste = () => {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isSupportedImage);
      if (files.length === 0) return;
      e.preventDefault();
      const { camera, size } = useViewportStore.getState();
      void placeFiles(files, screenToDoc(camera, size.width / 2, size.height / 2));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
};
