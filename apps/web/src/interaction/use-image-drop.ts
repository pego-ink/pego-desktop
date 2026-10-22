import { useEffect } from "react";
import { screenToDoc } from "@/canvas/types";
import { insertImageCentered, isSupportedImage, readImageFile } from "@/interaction/image-file";
import { useViewportStore } from "@/store/use-viewport-store";

const hasImageFile = (data: DataTransfer | null): boolean =>
  !!data &&
  Array.from(data.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");

/** Place each image file at a doc point (staggered slightly when several arrive at once). */
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
 * Drag-and-drop and clipboard paste of image files onto the canvas element. Drops land at the
 * pointer, pastes at the viewport center.
 */
export const useImageDrop = (target: React.RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const element = target.current;
    if (!element) return;

    const onDragOver = (e: DragEvent) => {
      if (!hasImageFile(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter(isSupportedImage);
      if (files.length === 0) return;
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      const { camera } = useViewportStore.getState();
      void placeFiles(files, screenToDoc(camera, e.clientX - rect.left, e.clientY - rect.top));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter(isSupportedImage);
      if (files.length === 0) return;
      e.preventDefault();
      const { camera, size } = useViewportStore.getState();
      void placeFiles(files, screenToDoc(camera, size.width / 2, size.height / 2));
    };

    element.addEventListener("dragover", onDragOver);
    element.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      element.removeEventListener("dragover", onDragOver);
      element.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [target]);
};
