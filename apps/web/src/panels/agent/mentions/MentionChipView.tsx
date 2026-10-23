import { XIcon } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { findNode } from "@pego/doc";
import { mentionNodeType, mentionTitle } from "@pego/agent";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { readMentionRef } from "./composer-doc";
import { MentionLayerList } from "./MentionLayerList";
import { MENTION_KIND_LABEL, MentionPill } from "./MentionPill";

/**
 * A chip in the composer. The label and icon follow the target (a layer's name and type); a chip
 * naming several layers lists them on hover. A chip whose target is gone (deleted layer, removed
 * image) is shown broken and is not sent to the agent.
 */
export const MentionChipView = ({ node, deleteNode, editor, selected }: NodeViewProps) => {
  const ref = readMentionRef(node.attrs);
  const doc = useDocumentStore((s) => s.doc);
  const attachments = useAgentStore((s) => s.pendingAttachments);
  const title = ref ? mentionTitle(doc, ref, { attachments }) : null;
  const fallback = typeof node.attrs.label === "string" ? node.attrs.label : "mention";
  const broken = title === null;
  const kind = ref?.kind ?? "layer";
  const layers =
    ref?.kind === "layer" && ref.ids.length > 1
      ? ref.ids.flatMap((id) => findNode(doc, id) ?? [])
      : [];
  return (
    <NodeViewWrapper as="span" className="inline">
      <MentionPill
        kind={kind}
        label={title ?? fallback}
        nodeType={ref ? mentionNodeType(doc, ref) : undefined}
        broken={broken}
        className={cn(selected && "border-ring")}
        title={
          broken ? (
            `${fallback} is no longer there; this mention will not be sent`
          ) : layers.length > 1 ? (
            <MentionLayerList nodes={layers} />
          ) : (
            `${MENTION_KIND_LABEL[kind]}: ${title}`
          )
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
