import { ArrowUpRightIcon } from "lucide-react";
import { PegoMark } from "@/components/PegoMark";
import { EXAMPLE_PROMPTS } from "@/panels/agent/agent-format";

export const AgentEmptyState = ({ onPick }: { onPick: (prompt: string) => void }) => (
  <div className="flex flex-col gap-4 py-2">
    <div className="flex flex-col items-center gap-2 px-2 pt-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-violet-soft">
        <PegoMark className="size-7" />
      </div>
      <h3 className="text-[15px] font-semibold">Ask Pego to design</h3>
      <p className="text-[13px] leading-5 text-muted-foreground">
        The agent plans, then edits the canvas live. You can undo everything it does.
      </p>
    </div>
    <div className="flex flex-col gap-2">
      <span className="px-0.5 font-mono text-[10px] tracking-wider text-subtle-foreground uppercase">
        Try
      </span>
      <ul className="flex flex-col gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              onClick={() => onPick(prompt)}
              className="flex w-full items-start gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-left text-[13px] leading-5 text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="min-w-0 flex-1">{prompt}</span>
              <ArrowUpRightIcon
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  </div>
);
