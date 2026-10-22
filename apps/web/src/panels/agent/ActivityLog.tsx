import { useId, useState } from "react";
import { AlertCircleIcon, ChevronRightIcon, InfoIcon, WrenchIcon } from "lucide-react";
import { Markdown } from "@pego/ui/components/markdown";
import { Spinner } from "@pego/ui/components/spinner";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore, type AgentLogEntry } from "@/agent/use-agent-store";
import { AttachmentStrip } from "@/panels/agent/attachments/AttachmentStrip";
import { collapseRuns, countFailed, groupLog, type ToolGroup } from "@/panels/agent/tool-groups";

const ACTIVE_STATUSES = new Set(["planning", "running", "awaiting_decision"]);

const ENTER_CLASS = "animate-[pego-slide-up-in_160ms_var(--ease-out)]";

const ToolGroupRow = ({
  group,
  live,
  className,
}: {
  group: ToolGroup;
  live: boolean;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { calls } = group;
  const failed = countFailed(calls);
  const showLive = live && !open;
  return (
    <li className={cn("font-mono text-[11px] leading-4", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-1.5 rounded-sm px-1 text-left text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
            "mt-0.5 size-3 shrink-0 transition-transform duration-(--duration-fast) ease-out",
            open && "rotate-90",
          )}
        />
      </button>
      <div
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-180 ease-out motion-reduce:transition-opacity",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
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
        </div>
      </div>
    </li>
  );
};

const Entry = ({ entry, className }: { entry: AgentLogEntry; className?: string }) => {
  switch (entry.kind) {
    case "user":
      return (
        <li
          className={cn(
            "flex flex-col gap-1.5 self-end rounded-md bg-muted px-2 py-1.5 text-xs",
            className,
          )}
        >
          {entry.attachments?.length ? (
            <AttachmentStrip
              attachments={entry.attachments}
              size="sm"
              className="flex flex-wrap justify-end gap-1"
            />
          ) : null}
          <span className="whitespace-pre-wrap">{entry.text}</span>
        </li>
      );
    case "assistant":
      return (
        <li className={cn("px-1 text-foreground", className)}>
          <Markdown text={entry.text} />
        </li>
      );
    case "error":
      return (
        <li
          className={cn(
            "flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive",
            className,
          )}
        >
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{entry.text}</span>
        </li>
      );
    case "info":
      return (
        <li
          className={cn(
            "flex items-start gap-1.5 px-1 text-[11px] leading-4 text-muted-foreground",
            className,
          )}
        >
          <InfoIcon className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 break-words">{entry.text}</span>
        </li>
      );
  }
};

export const ActivityLog = ({ log }: { log: readonly AgentLogEntry[] }) => {
  const count = log.length;
  const active = useAgentStore((s) => ACTIVE_STATUSES.has(s.status));
  const items = groupLog(log);
  // Items present on first render do not animate in; only entries that arrive afterwards do.
  const [initialIds] = useState(
    () => new Set(items.map((item) => (item.type === "tools" ? item.id : item.entry.id))),
  );

  if (count === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Activity" aria-live="polite">
      {items.map((item, index) => {
        const id = item.type === "tools" ? item.id : item.entry.id;
        const className = initialIds.has(id) ? undefined : ENTER_CLASS;
        return item.type === "tools" ? (
          <ToolGroupRow
            key={id}
            group={item}
            live={active && index === items.length - 1}
            className={className}
          />
        ) : (
          <Entry key={id} entry={item.entry} className={className} />
        );
      })}
    </ul>
  );
};
