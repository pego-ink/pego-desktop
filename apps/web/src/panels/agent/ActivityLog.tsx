import { Fragment, useId, useState } from "react";
import {
  AlertCircleIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  ImageIcon,
  InfoIcon,
  WrenchIcon,
} from "lucide-react";
import { Spinner } from "@pego/ui/components/spinner";
import { cn } from "@pego/ui/lib/utils";
import type { AgentLogEntry } from "@/agent/use-agent-store";
import { AssistantText } from "@/panels/agent/AssistantText";
import { AttachmentStrip } from "@/panels/agent/attachments/AttachmentStrip";
import { formatBytes } from "@/panels/agent/agent-format";
import { MentionPill } from "@/panels/agent/mentions/MentionPill";
import { collapseRuns, countFailed, groupLog, type ToolGroup } from "@/panels/agent/tool-groups";

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

const STEERED_LABELS = {
  pending: "Sending…",
  delivered: "Steered",
  failed: "Not delivered",
} as const;

/** Small tag on a user bubble that was sent into the running agent. */
const SteeredLabel = ({ state }: { state: keyof typeof STEERED_LABELS }) => (
  <span
    className={cn(
      "flex items-center gap-1 self-end text-[11px] leading-none text-muted-foreground",
      state === "failed" && "text-destructive",
    )}
  >
    <CornerDownRightIcon aria-hidden className="size-3" />
    {STEERED_LABELS[state]}
  </span>
);

const Entry = ({
  entry,
  className,
  animate,
}: {
  entry: AgentLogEntry;
  className?: string;
  animate: boolean;
}) => {
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
          {entry.attachmentsMeta?.length ? (
            <span className="flex flex-wrap justify-end gap-1">
              {entry.attachmentsMeta.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  title={`${file.name} · ${formatBytes(file.size)}`}
                  className="flex max-w-40 items-center gap-1 rounded-sm bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  <ImageIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </span>
              ))}
            </span>
          ) : null}
          {entry.steered ? <SteeredLabel state={entry.steered} /> : null}
          <span className="whitespace-pre-wrap">
            {entry.parts
              ? entry.parts.map((part, index) =>
                  part.kind === "text" ? (
                    <Fragment key={index}>{part.text}</Fragment>
                  ) : (
                    <MentionPill
                      key={index}
                      kind={part.mention}
                      label={part.label}
                      nodeType={part.nodeType}
                    />
                  ),
                )
              : entry.text}
          </span>
        </li>
      );
    case "assistant":
      return (
        <li className="px-1 text-foreground">
          <AssistantText text={entry.text} animate={animate} />
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

/**
 * One turn's activity. `active` marks the turn that is running right now (its last tool group
 * spins); earlier turns of the session are never live.
 */
export const ActivityLog = ({
  log,
  active = false,
}: {
  log: readonly AgentLogEntry[];
  active?: boolean;
}) => {
  const count = log.length;
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
          <Entry key={id} entry={item.entry} className={className} animate={!initialIds.has(id)} />
        );
      })}
    </ul>
  );
};
