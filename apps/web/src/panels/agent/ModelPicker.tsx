import { useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { LocalAgentId } from "@pego/agent";
import { Input } from "@pego/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { cn } from "@pego/ui/lib/utils";
import { requestModels } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import {
  customModelCandidate,
  filterModels,
  MODEL_DEFAULT_LABEL,
} from "@/panels/agent/agent-format";

/** Long lists (opencode lists every provider) stay responsive: render the first N matches. */
const MAX_VISIBLE = 150;

const optionClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent";

type ModelPickerProps = {
  agentId: LocalAgentId;
  disabled?: boolean;
};

export const ModelPicker = ({ agentId, disabled }: ModelPickerProps) => {
  const selected = useAgentStore((s) => s.modelByAgent[agentId]);
  const entry = useAgentStore((s) => s.modelsByAgent[agentId]);
  const setModel = useAgentStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const models = entry?.models ?? [];
  const matches = filterModels(models, query);
  const visible = matches.slice(0, MAX_VISIBLE);
  const custom = customModelCandidate(models, query);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setQuery("");
    requestModels(agentId);
  };

  const pick = (model: string | undefined) => {
    setModel(agentId, model);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = visible[0];
    if (custom && (!first || first.toLowerCase() !== custom.toLowerCase())) pick(custom);
    else if (first) pick(first);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">Model</span>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          disabled={disabled}
          aria-label="Model"
          className="flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-transparent bg-muted px-2 text-xs text-foreground outline-none transition-colors hover:border-border focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ?? MODEL_DEFAULT_LABEL}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="grid gap-1">
          <Input
            autoFocus
            aria-label="Search models"
            placeholder="Search or type a model id"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div role="listbox" aria-label="Models" className="max-h-56 overflow-y-auto">
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              onClick={() => pick(undefined)}
              className={optionClass}
            >
              <span className="min-w-0 flex-1 truncate">{MODEL_DEFAULT_LABEL}</span>
              <span className="text-[11px] text-muted-foreground">CLI default</span>
              {selected ? null : <CheckIcon className="size-3.5" />}
            </button>
            {custom ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(custom)}
                className={optionClass}
              >
                <span className="min-w-0 flex-1 truncate">
                  Use <span className="font-medium">&ldquo;{custom}&rdquo;</span>
                </span>
              </button>
            ) : null}
            {visible.map((model) => (
              <button
                key={model}
                type="button"
                role="option"
                aria-selected={model === selected}
                onClick={() => pick(model)}
                className={optionClass}
              >
                <span className="min-w-0 flex-1 truncate">{model}</span>
                {model === selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
              </button>
            ))}
            {matches.length > visible.length ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {matches.length - visible.length} more. Refine the search.
              </p>
            ) : null}
            {entry?.loading ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">Loading models…</p>
            ) : null}
            {entry?.error ? (
              <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 text-destructive">{entry.error}</span>
                <button
                  type="button"
                  onClick={() => requestModels(agentId, true)}
                  className="shrink-0 text-foreground underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : null}
            {entry?.loaded && !entry.error && models.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                No model list from this CLI. Type a model id above.
              </p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
