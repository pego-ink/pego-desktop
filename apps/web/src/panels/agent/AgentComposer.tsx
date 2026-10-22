import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon, PaperclipIcon, SquareIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { cancelRun, startRun } from "@/agent/run";
import { useAgentStore, useVisibleRun } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { AgentSelector } from "@/panels/agent/AgentSelector";
import { SkillChip } from "@/panels/agent/SkillChip";
import { AttachmentStrip } from "@/panels/agent/attachments/AttachmentStrip";
import { addAttachmentFiles } from "@/panels/agent/attachments/add-files";
import { ATTACH_ACCEPT, pastedImageFiles } from "@/panels/agent/attachments/attachment-utils";
import { useAttachmentDrop } from "@/panels/agent/attachments/use-attachment-drop";
import { isRunActive, selectionHint } from "@/panels/agent/agent-format";
import { safely } from "@/panels/agent/run-actions";

const ACTION_BUTTON =
  "flex size-7 items-center justify-center rounded-full bg-foreground text-background outline-none transition-[background-color,opacity,scale] duration-120 ease-out focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]";

type AgentComposerProps = {
  /** Text to place in the box (e.g. an example prompt); applied whenever `key` changes. */
  seed: { text: string; key: number };
};

export const AgentComposer = ({ seed }: AgentComposerProps) => {
  const active = useVisibleRun((s) => isRunActive(s.status));
  const runId = useVisibleRun((s) => s.runId);
  const selectionCount = useDocumentStore((s) => s.selection.length);
  const hint = selectionHint(selectionCount);

  const attachments = useAgentStore((s) => s.pendingAttachments);
  const removeAttachment = useAgentStore((s) => s.removeAttachment);
  const drop = useAttachmentDrop(!active);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [seenSeed, setSeenSeed] = useState(seed.key);
  if (seenSeed !== seed.key) {
    setSeenSeed(seed.key);
    setValue(seed.text);
  }

  const canSend = !active && value.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    const prompt = value.trim();
    setValue("");
    void safely(() => startRun(prompt)).then((ok) => {
      if (!ok) setValue(prompt);
    });
  };

  const onPickFiles = (files: FileList | null) => {
    if (files) void addAttachmentFiles(Array.from(files));
    // Reset so picking the same file again still fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const { files, types } = event.clipboardData;
    const images = pastedImageFiles(Array.from(files), Array.from(types));
    if (images.length === 0) return; // plain text paste stays the browser's
    event.preventDefault();
    void addAttachmentFiles(images);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <div
      {...drop.handlers}
      className={cn(
        "relative rounded-lg border border-border bg-muted/40 p-2 transition-[border-color,opacity] duration-(--duration-fast) ease-out focus-within:border-ring",
        active && "opacity-70",
        drop.dragging && "border-ring",
      )}
    >
      <AttachmentStrip
        attachments={attachments}
        onRemove={(attachment) => {
          removeAttachment(attachment.id);
          textareaRef.current?.focus();
        }}
        className="mb-1 flex flex-wrap gap-2 px-1 pt-2"
      />
      <textarea
        ref={textareaRef}
        aria-label="Prompt"
        value={value}
        disabled={active}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={active ? "Agent is working…" : "Describe what to design…"}
        className="max-h-40 min-h-12 w-full resize-none bg-transparent px-1 text-xs leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <div className="mt-1 flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          tabIndex={-1}
          aria-hidden
          className="hidden"
          onChange={(event) => onPickFiles(event.target.files)}
        />
        <button
          type="button"
          aria-label="Attach images"
          title="Attach images"
          disabled={active}
          onClick={() => fileInputRef.current?.click()}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <PaperclipIcon aria-hidden className="size-3.5" />
        </button>
        <AgentSelector restoreFocusRef={textareaRef} />
        <SkillChip prompt={value} restoreFocusRef={textareaRef} />
        {hint ? (
          <span className="min-w-0 flex-1 truncate rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {hint}
          </span>
        ) : (
          // Spacer keeps the send button at the end of the row.
          <span aria-hidden className="min-w-0 flex-1" />
        )}
        <div className="relative size-7 shrink-0">
          <button
            type="button"
            aria-label="Cancel run"
            title="Cancel run"
            inert={!active}
            onClick={() => {
              if (runId) void safely(() => cancelRun(runId));
            }}
            className={cn(
              ACTION_BUTTON,
              "absolute inset-0 hover:bg-foreground/90",
              !active && "pointer-events-none opacity-0",
            )}
          >
            <SquareIcon className="size-3 fill-current" />
          </button>
          <button
            type="button"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!canSend}
            inert={active}
            onClick={send}
            className={cn(
              ACTION_BUTTON,
              "absolute inset-0 hover:bg-foreground/90",
              active ? "pointer-events-none opacity-0" : "disabled:opacity-30",
            )}
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-ring bg-background/85 text-xs font-medium text-foreground transition-opacity duration-(--duration-fast) ease-out",
          drop.dragging ? "opacity-100" : "opacity-0",
        )}
      >
        Drop images to attach
      </div>
    </div>
  );
};
