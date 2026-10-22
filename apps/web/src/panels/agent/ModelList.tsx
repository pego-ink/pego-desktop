import { useEffect, useState, type KeyboardEvent } from "react";
import { CheckIcon } from "lucide-react";
import type { LocalAgentId } from "@pego/agent";
import { Input } from "@pego/ui/components/input";
import { requestModels } from "@/agent/local-agents";
import { useAgentStore } from "@/agent/use-agent-store";
import { navigateList } from "@/panels/agent/list-nav";
import {
  customModelCandidate,
  filterModels,
  MODEL_DEFAULT_LABEL,
} from "@/panels/agent/agent-format";

/** Long lists (opencode lists every provider) stay responsive: render the first N matches. */
const MAX_VISIBLE = 150;

const optionClass =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent";

type ModelListProps = {
  agentId: LocalAgentId;
  /** Called with the chosen model id, or undefined for the CLI default. */
  onPick: (model: string | undefined) => void;
};

/** Searchable model options for one agent: Default, a free-text custom id, then the CLI's list. */
export const ModelList = ({ agentId, onPick }: ModelListProps) => {
  const selected = useAgentStore((s) => s.modelByAgent[agentId]);
  const entry = useAgentStore((s) => s.modelsByAgent[agentId]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    requestModels(agentId);
  }, [agentId]);

  const models = entry?.models ?? [];
  const matches = filterModels(models, query);
  const visible = matches.slice(0, MAX_VISIBLE);
  const custom = customModelCandidate(models, query);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = visible[0];
    if (custom && (!first || first.toLowerCase() !== custom.toLowerCase())) onPick(custom);
    else if (first) onPick(first);
  };

  return (
    <div className="grid gap-0.5" onKeyDown={navigateList}>
      <Input
        data-nav
        autoFocus
        aria-label="Search models"
        placeholder="Search or type a model id"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onInputKeyDown}
        className="h-7 px-2 text-[13px] md:text-[13px]"
      />
      <div role="listbox" aria-label="Models" className="max-h-52 overflow-y-auto">
        <button
          data-nav
          type="button"
          role="option"
          aria-selected={!selected}
          onClick={() => onPick(undefined)}
          className={optionClass}
        >
          <span className="min-w-0 flex-1 truncate">{MODEL_DEFAULT_LABEL}</span>
          <span className="text-[11px] text-muted-foreground">CLI default</span>
          {selected ? null : <CheckIcon className="size-3.5 shrink-0" />}
        </button>
        {custom ? (
          <button
            data-nav
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(custom)}
            className={optionClass}
          >
            <span className="min-w-0 flex-1 truncate">
              Use <span className="font-medium">&ldquo;{custom}&rdquo;</span>
            </span>
          </button>
        ) : null}
        {visible.map((model) => (
          <button
            data-nav
            key={model}
            type="button"
            role="option"
            aria-selected={model === selected}
            onClick={() => onPick(model)}
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
          <p role="status" className="px-2 py-1.5 text-[11px] text-muted-foreground">
            Loading models…
          </p>
        ) : null}
        {entry?.error ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
            <span className="min-w-0 flex-1 text-destructive">{entry.error}</span>
            <button
              data-nav
              type="button"
              onClick={() => requestModels(agentId, true)}
              className="shrink-0 rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
    </div>
  );
};
