import { useEffect } from "react";
import { screenToDoc } from "@/canvas/types";
import { isSupportedImage, isSvgFile, placeImageFile } from "@/interaction/image-file";
import { useViewportStore, viewportCenter } from "@/store/use-viewport-store";
import { imageLinkFromHtml, imageLinkFromText, placeImageFromUrl } from "@/images/image-from-url";

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");

/**
 * Place each image file around a doc point (staggered slightly when several arrive at once); SVG
 * files become vector layers.
 */
const placeFiles = async (files: readonly File[], point: { x: number; y: number }) => {
  for (const [i, file] of files.entries()) {
    await placeImageFile(file, { x: point.x + i * 24, y: point.y + i * 24 });
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
      const files = Array.from(e.clipboardData?.files ?? []).filter(
        (file) => isSupportedImage(file) || isSvgFile(file),
      );
      if (files.length === 0) {
        const link = e.clipboardData ? pastedImageLink(e.clipboardData) : null;
        if (!link) return;
        e.preventDefault();
        void placeImageFromUrl(link);
        return;
      }
      e.preventDefault();
      const middle = viewportCenter();
      void placeFiles(files, screenToDoc(useViewportStore.getState().camera, middle.x, middle.y));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
};
