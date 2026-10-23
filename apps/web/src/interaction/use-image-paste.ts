import { useEffect } from "react";
import { screenToDoc } from "@/canvas/types";
import { insertImageCentered, isSupportedImage, readImageFile } from "@/interaction/image-file";
import { useViewportStore } from "@/store/use-viewport-store";
import { imageLinkFromHtml, imageLinkFromText, placeImageFromUrl } from "@/images/image-from-url";

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

/** The image link a paste carries: an image copied from a web page, or a link to an image file. */
export const pastedImageLink = (data: Pick<DataTransfer, "getData">): string | null =>
  imageLinkFromHtml(data.getData("text/html")) ?? imageLinkFromText(data.getData("text/plain"));

/**
 * Clipboard paste of image files onto the canvas, at the viewport center; an image copied from a
 * web page or a link to an image is downloaded and placed the same way. Drops are handled by the
 * canvas container (`dropFiles`), which also opens .pego/.pen files.
 */
export const useImagePaste = () => {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isSupportedImage);
      if (files.length === 0) {
        const link = e.clipboardData ? pastedImageLink(e.clipboardData) : null;
        if (!link) return;
        e.preventDefault();
        void placeImageFromUrl(link);
        return;
      }
      e.preventDefault();
      const { camera, size } = useViewportStore.getState();
      void placeFiles(files, screenToDoc(camera, size.width / 2, size.height / 2));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
};
