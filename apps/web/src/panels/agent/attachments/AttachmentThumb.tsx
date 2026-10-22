import { useMemo } from "react";
import { XIcon } from "lucide-react";
import type { RunAttachment } from "@pego/agent";
import { cn } from "@pego/ui/lib/utils";
import { attachmentDataUrl } from "@/agent/attachments";
import { attachmentTitle } from "@/panels/agent/attachments/attachment-utils";

const SIZES = { md: "size-12", sm: "size-10" } as const;

type AttachmentThumbProps = {
  attachment: RunAttachment;
  /** md = composer (48px), sm = user bubble (40px). */
  size?: keyof typeof SIZES;
  /** Open the larger preview. */
  onOpen: (attachment: RunAttachment) => void;
  /** Shows the remove button when given. */
  onRemove?: (attachment: RunAttachment) => void;
};

/** One attached image: a button that opens the preview, with an optional remove button. */
export const AttachmentThumb = ({
  attachment,
  size = "md",
  onOpen,
  onRemove,
}: AttachmentThumbProps) => {
  const src = useMemo(() => attachmentDataUrl(attachment), [attachment]);
  const title = attachmentTitle(attachment.name);
  return (
    <li className="relative shrink-0">
      <button
        type="button"
        title={title}
        aria-label={`Preview ${attachment.name}`}
        onClick={() => onOpen(attachment)}
        className={cn(
          SIZES[size],
          "block overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${attachment.name}`}
          title="Remove"
          onClick={() => onRemove(attachment)}
          className="group/remove absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full outline-none"
        >
          <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-background transition-[opacity,scale] duration-(--duration-fast) ease-out group-hover/remove:opacity-90 group-focus-visible/remove:ring-2 group-focus-visible/remove:ring-ring/50 group-focus-visible/remove:ring-offset-1 group-focus-visible/remove:ring-offset-background motion-safe:group-active/remove:scale-[.96]">
            <XIcon aria-hidden className="size-2.5" strokeWidth={2.5} />
          </span>
        </button>
      ) : null}
    </li>
  );
};
