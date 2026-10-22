import { toast } from "sonner";
import { useAgentStore } from "@/agent/use-agent-store";
import { limitMessages, planAdditions } from "./attachment-utils";
import { AttachmentError, processImageFile } from "./process-image";

/** Files being decoded right now; counted against the limit so a quick second drop cannot overshoot. */
let inFlight = 0;

const displayName = (file: File) => file.name || "This file";

/**
 * Validate, process and store image files as pending attachments, with a friendly toast for
 * everything that was skipped. Never throws.
 */
export const addAttachmentFiles = async (files: readonly File[]): Promise<void> => {
  if (files.length === 0) return;
  const store = useAgentStore.getState();
  const plan = planAdditions(files, store.pendingAttachments.length, inFlight);

  for (const { file, reason } of plan.rejected) {
    toast.error(
      reason === "type"
        ? limitMessages.type(displayName(file))
        : limitMessages.size(displayName(file)),
    );
  }
  if (plan.overflow > 0) toast.error(limitMessages.count);

  for (const file of plan.accepted) {
    inFlight += 1;
    try {
      const attachment = await processImageFile(file);
      // The store assigns the id and enforces the limit atomically.
      if (!useAgentStore.getState().addAttachment(attachment)) toast.error(limitMessages.count);
    } catch (error) {
      const code = error instanceof AttachmentError ? error.code : "unreadable";
      const name = displayName(file);
      toast.error(
        code === "type"
          ? limitMessages.type(name)
          : code === "size"
            ? limitMessages.size(name)
            : limitMessages.unreadable(name),
      );
    } finally {
      inFlight -= 1;
    }
  }
};
