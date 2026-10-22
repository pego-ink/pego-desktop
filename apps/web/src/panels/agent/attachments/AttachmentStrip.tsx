import { useState } from "react";
import type { RunAttachment } from "@pego/agent";
import { AttachmentPreviewDialog } from "@/panels/agent/attachments/AttachmentPreviewDialog";
import { AttachmentThumb } from "@/panels/agent/attachments/AttachmentThumb";

type AttachmentStripProps = {
  attachments: readonly RunAttachment[];
  /** Composer mode: thumbnails get a remove button. */
  onRemove?: (attachment: RunAttachment) => void;
  size?: "md" | "sm";
  className?: string;
};

/** Row of attachment thumbnails; each opens the preview dialog. */
export const AttachmentStrip = ({
  attachments,
  onRemove,
  size,
  className,
}: AttachmentStripProps) => {
  const [previewed, setPreviewed] = useState<RunAttachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul aria-label="Attached images" className={className}>
        {attachments.map((attachment) => (
          <AttachmentThumb
            key={attachment.id}
            attachment={attachment}
            size={size}
            onOpen={setPreviewed}
            onRemove={onRemove}
          />
        ))}
      </ul>
      <AttachmentPreviewDialog attachment={previewed} onClose={() => setPreviewed(null)} />
    </>
  );
};
