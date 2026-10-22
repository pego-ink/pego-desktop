import { useEffect, useRef } from "react";
import { AlertCircleIcon, InfoIcon, WrenchIcon } from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import type { AgentLogEntry } from "@/agent/use-agent-store";

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
        <li className="px-1 text-xs leading-4 whitespace-pre-wrap text-foreground">{entry.text}</li>
      );
    case "tool":
      return (
        <li
          className={cn(
            "flex items-start gap-1.5 px-1 font-mono text-[11px] leading-4",
            entry.tool?.isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {entry.tool?.isError ? (
            <AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
          ) : (
            <WrenchIcon className="mt-0.5 size-3 shrink-0" />
          )}
          <span className="min-w-0 break-words">
            {entry.tool ? <span className="font-semibold">{entry.tool.name}</span> : null}
            {entry.text ? ` ${entry.text}` : ""}
          </span>
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

  useEffect(() => {
    if (count > 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (count === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Activity" aria-live="polite">
      {log.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
      <li ref={endRef} aria-hidden className="h-0" />
    </ul>
  );
};
