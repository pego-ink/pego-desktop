import { SparklesIcon } from "lucide-react";
import { EXAMPLE_PROMPTS } from "@/panels/agent/agent-format";

export const AgentEmptyState = ({ onPick }: { onPick: (prompt: string) => void }) => (
  <div className="flex flex-col gap-3 py-2">
    <div className="flex flex-col items-center gap-1.5 px-2 pt-4 text-center">
      <SparklesIcon className="size-5 text-muted-foreground" />
      <h3 className="text-[13px] font-medium">Ask Pego to design</h3>
      <p className="text-xs leading-4 text-muted-foreground">
        The agent plans, then edits the canvas live. You can undo everything it does.
      </p>
    </div>
    <ul className="flex flex-col gap-1.5">
      {EXAMPLE_PROMPTS.map((prompt) => (
        <li key={prompt}>
          <button
            type="button"
            onClick={() => onPick(prompt)}
            className="w-full rounded-md border border-border px-2.5 py-2 text-left text-xs leading-4 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {prompt}
          </button>
        </li>
      ))}
    </ul>
  </div>
);
