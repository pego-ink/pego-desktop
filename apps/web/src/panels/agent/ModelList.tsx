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

type ModelOptionsProps = {
  models: readonly string[];
  selected: string | undefined;
  /** Called with the chosen model id, or undefined for the default row. */
  onPick: (model: string | undefined) => void;
  /** Show a "Default" row (local CLIs have one; custom providers always need a model). */
  allowDefault: boolean;
  /** Label next to the default row. */
  defaultHint?: string;
  loading?: boolean;
  error?: string;
  loaded?: boolean;
  onRetry?: () => void;
  /** Where the empty note points the user. */
  emptyNote: string;
  /** Reject a typed id (hides the "Use ..." row for it). */
  acceptCustom?: (id: string) => boolean;
};

/** Searchable model options: optional Default, a free-text custom id, then the given list. */
export const ModelOptions = ({
  models,
  selected,
  onPick,
  allowDefault,
  defaultHint,
  loading,
  error,
  loaded,
  onRetry,
  emptyNote,
  acceptCustom,
}: ModelOptionsProps) => {
  const [query, setQuery] = useState("");

  const matches = filterModels(models, query);
  const visible = matches.slice(0, MAX_VISIBLE);
  const candidate = customModelCandidate(models, query);
  const custom = candidate && (!acceptCustom || acceptCustom(candidate)) ? candidate : null;

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
        {allowDefault ? (
          <button
            data-nav
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => onPick(undefined)}
            className={optionClass}
          >
            <span className="min-w-0 flex-1 truncate">{MODEL_DEFAULT_LABEL}</span>
            <span className="text-[11px] text-muted-foreground">{defaultHint}</span>
            {selected ? null : <CheckIcon className="size-3.5 shrink-0" />}
          </button>
        ) : null}
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
        {loading ? (
          <p role="status" className="px-2 py-1.5 text-[11px] text-muted-foreground">
            Loading models…
          </p>
        ) : null}
        {error ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
            <span className="min-w-0 flex-1 text-destructive">{error}</span>
            {onRetry ? (
              <button
                data-nav
                type="button"
                onClick={onRetry}
                className="shrink-0 rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {loaded && !error && models.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{emptyNote}</p>
        ) : null}
      </div>
    </div>
  );
};

type ModelListProps = {
  agentId: LocalAgentId;
  /** Called with the chosen model id, or undefined for the CLI default. */
  onPick: (model: string | undefined) => void;
};

/** Model options for one local agent: Default, a free-text custom id, then the CLI's list. */
export const ModelList = ({ agentId, onPick }: ModelListProps) => {
  const selected = useAgentStore((s) => s.modelByAgent[agentId]);
  const entry = useAgentStore((s) => s.modelsByAgent[agentId]);

  useEffect(() => {
    requestModels(agentId);
  }, [agentId]);

  return (
    <ModelOptions
      models={entry?.models ?? []}
      selected={selected}
      onPick={onPick}
      allowDefault
      defaultHint="CLI default"
      loading={entry?.loading}
      error={entry?.error}
      loaded={entry?.loaded}
      onRetry={() => requestModels(agentId, true)}
      emptyNote="No model list from this CLI. Type a model id above."
    />
  );
};
