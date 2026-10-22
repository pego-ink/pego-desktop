import { useMemo } from "react";
import type { RunAttachment } from "@pego/agent";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { attachmentDataUrl } from "@/agent/attachments";

type AttachmentPreviewDialogProps = {
  attachment: RunAttachment | null;
  onClose: () => void;
};

const describe = (attachment: RunAttachment) => {
  const size =
    attachment.width && attachment.height ? `${attachment.width} × ${attachment.height} px` : "";
  return [size, attachment.mediaType.replace("image/", "").toUpperCase()]
    .filter(Boolean)
    .join(" · ");
};

/** Larger view of an attached image. */
export const AttachmentPreviewDialog = ({ attachment, onClose }: AttachmentPreviewDialogProps) => {
  const src = useMemo(() => (attachment ? attachmentDataUrl(attachment) : ""), [attachment]);
  return (
    <Dialog open={attachment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        {attachment ? (
          <>
            <DialogHeader className="pr-6">
              <DialogTitle className="truncate">{attachment.name}</DialogTitle>
              <DialogDescription>{describe(attachment)}</DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[70vh] justify-center overflow-hidden rounded-md bg-muted">
              <img
                src={src}
                alt={attachment.name}
                className="max-h-[70vh] max-w-full object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
