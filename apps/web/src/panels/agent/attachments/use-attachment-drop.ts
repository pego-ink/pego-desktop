import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { addAttachmentFiles } from "./add-files";
import { limitMessages } from "./attachment-utils";

const hasFiles = (data: DataTransfer | null): boolean => !!data && data.types.includes("Files");

/**
 * Drop-zone handlers for the composer. Spread `handlers` on the container; `dragging` drives the
 * highlight. Every file drop is claimed (default prevented, propagation stopped) so the browser
 * does not navigate to the file and the canvas drop handler does not also place the image.
 */
export const useAttachmentDrop = (enabled: boolean) => {
  const [dragging, setDragging] = useState(false);
  // dragenter/leave fire for every child; the counter says whether the pointer is still inside.
  const depth = useRef(0);

  const claim = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  return {
    dragging: dragging && enabled,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!hasFiles(event.dataTransfer)) return;
        claim(event);
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!hasFiles(event.dataTransfer)) return;
        claim(event);
        event.dataTransfer.dropEffect = enabled ? "copy" : "none";
      },
      onDragLeave: (event: DragEvent) => {
        if (!hasFiles(event.dataTransfer)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!hasFiles(event.dataTransfer)) return;
        claim(event);
        reset();
        if (!enabled) return void toast.error(limitMessages.busy);
        void addAttachmentFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
};
