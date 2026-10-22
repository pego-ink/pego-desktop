import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { cancelRun, startRun } from "@/agent/run";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { AgentSelector } from "@/panels/agent/AgentSelector";
import { SkillChip } from "@/panels/agent/SkillChip";
import { isRunActive, selectionHint } from "@/panels/agent/agent-format";
import { safely } from "@/panels/agent/run-actions";

const ACTION_BUTTON =
  "flex size-7 items-center justify-center rounded-full bg-foreground text-background outline-none transition-[background-color,opacity,scale] duration-120 ease-out focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]";

type AgentComposerProps = {
  /** Text to place in the box (e.g. an example prompt); applied whenever `key` changes. */
  seed: { text: string; key: number };
};

export const AgentComposer = ({ seed }: AgentComposerProps) => {
  const active = useAgentStore((s) => isRunActive(s.status));
  const selectionCount = useDocumentStore((s) => s.selection.length);
  const hint = selectionHint(selectionCount);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/40 p-2 transition-[border-color,opacity] duration-(--duration-fast) ease-out focus-within:border-ring",
        active && "opacity-70",
      )}
    >
      <textarea
        ref={textareaRef}
        aria-label="Prompt"
        value={value}
        disabled={active}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={active ? "Agent is working…" : "Describe what to design…"}
        className="max-h-40 min-h-12 w-full resize-none bg-transparent px-1 text-xs leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <div className="mt-1 flex items-center gap-1">
        <AgentSelector restoreFocusRef={textareaRef} />
        <SkillChip prompt={value} restoreFocusRef={textareaRef} />
        {hint ? (
          <span className="min-w-0 flex-1 truncate rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {hint}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
            Enter to send
          </span>
        )}
        <div className="relative size-7 shrink-0">
          <button
            type="button"
            aria-label="Cancel run"
            title="Cancel run"
            inert={!active}
            onClick={() => void safely(cancelRun)}
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
    </div>
  );
};
