import { useState, type KeyboardEvent } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import { cancelRun, startRun } from "@/agent/run";
import { useAgentStore } from "@/agent/use-agent-store";
import { useDocumentStore } from "@/store/use-document-store";
import { isRunActive, selectionHint } from "@/panels/agent/agent-format";
import { safely } from "@/panels/agent/run-actions";

type AgentComposerProps = {
  /** Text to place in the box (e.g. an example prompt); applied whenever `key` changes. */
  seed: { text: string; key: number };
};

export const AgentComposer = ({ seed }: AgentComposerProps) => {
  const active = useAgentStore((s) => isRunActive(s.status));
  const selectionCount = useDocumentStore((s) => s.selection.length);
  const hint = selectionHint(selectionCount);

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
        "rounded-lg border border-border bg-muted/40 p-2 transition-colors focus-within:border-ring",
        active && "opacity-70",
      )}
    >
      <textarea
        aria-label="Prompt"
        value={value}
        disabled={active}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={active ? "Agent is working…" : "Describe what to design…"}
        className="max-h-40 min-h-12 w-full resize-none bg-transparent px-1 text-xs leading-5 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        {hint ? (
          <span className="truncate rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {hint}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Enter to send</span>
        )}
        {active ? (
          <button
            type="button"
            aria-label="Cancel run"
            title="Cancel run"
            onClick={() => void safely(cancelRun)}
            className="flex size-7 items-center justify-center rounded-full bg-foreground text-background outline-none hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <SquareIcon className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!canSend}
            onClick={send}
            className="flex size-7 items-center justify-center rounded-full bg-foreground text-background outline-none hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-30"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
};
