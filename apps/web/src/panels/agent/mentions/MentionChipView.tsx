import { XIcon } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { mentionTitle } from "@pego/agent";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { readMentionRef } from "./composer-doc";
import { MENTION_KIND_LABEL, MentionPill } from "./MentionPill";

/**
 * A chip in the composer. The label follows the target's current name; a chip whose target is
 * gone (deleted layer, removed image) is shown broken and is not sent to the agent.
 */
export const MentionChipView = ({ node, deleteNode, editor }: NodeViewProps) => {
  const ref = readMentionRef(node.attrs);
  const doc = useDocumentStore((s) => s.doc);
  const attachments = useAgentStore((s) => s.pendingAttachments);
  const title = ref ? mentionTitle(doc, ref, { attachments }) : null;
  const fallback = typeof node.attrs.label === "string" ? node.attrs.label : "mention";
  const broken = title === null;
  const kind = ref?.kind ?? "layer";
  return (
    <NodeViewWrapper as="span" className="inline">
      <MentionPill
        kind={kind}
        label={title ?? fallback}
        broken={broken}
        title={
          broken
            ? `${fallback} is no longer there; this mention will not be sent`
            : `${MENTION_KIND_LABEL[kind]}: ${title}`
        }
      >
        {editor.isEditable ? (
          <button
            type="button"
            aria-label={`Remove ${title ?? fallback}`}
            contentEditable={false}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => deleteNode()}
            className="-mr-0.5 flex size-3.5 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <XIcon className="size-2.5" />
          </button>
        ) : null}
      </MentionPill>
    </NodeViewWrapper>
  );
};
