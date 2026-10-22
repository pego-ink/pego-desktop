import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { LocalAgentId } from "@pego/agent";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { ModelList } from "@/panels/agent/ModelList";
import { MODEL_DEFAULT_LABEL } from "@/panels/agent/agent-format";

type ModelPickerProps = {
  agentId: LocalAgentId;
  disabled?: boolean;
};

/** Dropdown for an agent's default model (used in Model settings). */
export const ModelPicker = ({ agentId, disabled }: ModelPickerProps) => {
  const selected = useAgentStore((s) => s.modelByAgent[agentId]);
  const setModel = useAgentStore((s) => s.setModel);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label="Default model"
        className="flex h-7 w-44 min-w-0 items-center justify-between gap-1 rounded-md border border-transparent bg-muted px-2 text-xs text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ?? MODEL_DEFAULT_LABEL}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <ModelList
          agentId={agentId}
          onPick={(model) => {
            setModel(agentId, model);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
