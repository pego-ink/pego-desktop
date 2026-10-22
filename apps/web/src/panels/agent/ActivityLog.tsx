import { useEffect, useId, useRef, useState } from "react";
import { AlertCircleIcon, ChevronRightIcon, InfoIcon, WrenchIcon } from "lucide-react";
import { Markdown } from "@pego/ui/components/markdown";
import { Spinner } from "@pego/ui/components/spinner";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore, type AgentLogEntry } from "@/agent/use-agent-store";
import { collapseRuns, countFailed, groupLog, type ToolGroup } from "@/panels/agent/tool-groups";

const ACTIVE_STATUSES = new Set(["planning", "running", "awaiting_decision"]);

const ToolGroupRow = ({ group, live }: { group: ToolGroup; live: boolean }) => {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { calls } = group;
  const failed = countFailed(calls);
  const showLive = live && !open;
  return (
    <li className="font-mono text-[11px] leading-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-1.5 rounded-sm px-1 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {showLive ? (
          <Spinner className="mt-0.5 size-3 border-[1.5px]" />
        ) : (
          <WrenchIcon className="mt-0.5 size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 break-words">
          <span className="font-semibold">
            {calls.length} {calls.length === 1 ? "tool" : "tools"}
          </span>
          {failed > 0 ? <span className="text-destructive"> · {failed} failed</span> : null}
        </span>
        <ChevronRightIcon
          className={cn(
            "mt-0.5 size-3 shrink-0 transition-transform duration-150 ease-out",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <ul id={listId} className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-l pl-2">
          {collapseRuns(calls).map((run) => (
            <li
              key={run.key}
              className={cn(
                "flex items-start gap-1 break-words",
                run.failed ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {run.failed ? <AlertCircleIcon className="mt-0.5 size-3 shrink-0" /> : null}
              <span className="min-w-0">
                <span className="font-semibold">{run.name}</span>
                {run.detail ? ` ${run.detail}` : ""}
                {run.count > 1 ? <span className="tabular-nums"> ×{run.count}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
};

const Entry = ({ entry }: { entry: AgentLogEntry }) => {
  switch (entry.kind) {
    case "user":
      return (
        <li className="self-end rounded-md bg-muted px-2 py-1.5 text-xs whitespace-pre-wrap">
          {entry.text}
        </li>
      );
    case "assistant":
      return (
        <li className="px-1 text-foreground">
          <Markdown text={entry.text} />
        </li>
      );
    case "error":
      return (
        <li className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{entry.text}</span>
        </li>
      );
    case "info":
      return (
        <li className="flex items-start gap-1.5 px-1 text-[11px] leading-4 text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 break-words">{entry.text}</span>
        </li>
      );
  }
};

export const ActivityLog = ({ log }: { log: readonly AgentLogEntry[] }) => {
  const endRef = useRef<HTMLLIElement>(null);
  const count = log.length;
  const active = useAgentStore((s) => ACTIVE_STATUSES.has(s.status));
  const items = groupLog(log);

  useEffect(() => {
    if (count > 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (count === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Activity" aria-live="polite">
      {items.map((item, index) =>
        item.type === "tools" ? (
          <ToolGroupRow key={item.id} group={item} live={active && index === items.length - 1} />
        ) : (
          <Entry key={item.entry.id} entry={item.entry} />
        ),
      )}
      <li ref={endRef} aria-hidden className="h-0" />
    </ul>
  );
};
