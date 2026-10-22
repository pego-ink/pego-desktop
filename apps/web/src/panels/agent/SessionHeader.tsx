import { useState, type KeyboardEvent } from "react";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { Popover, PopoverContent, PopoverTrigger } from "@pego/ui/components/popover";
import { Tooltip } from "@pego/ui/components/tooltip";
import { cn } from "@pego/ui/lib/utils";
import {
  removeSession,
  renameSession,
  startNewSession,
  switchSession,
} from "@/agent/sessions/session-sync";
import { sessionTitle } from "@/agent/sessions/session-model";
import { useSessionsStore } from "@/agent/sessions/use-sessions-store";
import { currentTurn, useAgentStore, type AgentStoreState } from "@/agent/use-agent-store";
import { SessionList } from "@/panels/agent/SessionList";
import { isRunActive, runStatusLabel } from "@/panels/agent/agent-format";

/** Cheap title for a selector: avoids copying the whole transcript on every streamed token. */
const liveTitle = (s: AgentStoreState): string => {
  const latest = s.turns.length === 0 ? currentTurn(s) : null;
  return sessionTitle({ customTitle: s.sessionTitle, turns: latest ? [latest] : s.turns });
};

/** Compact run status under the title: pulsing dot while working, red when failed. */
const RunStatusLine = () => {
  const status = useAgentStore((s) => s.status);
  const runLabel = useAgentStore((s) => s.runLabel);
  // A restored session has no live run; show how its last turn ended.
  const last = useAgentStore((s) => (s.status === "idle" ? s.turns.at(-1) : undefined));
  const shown = status === "idle" ? last?.status : status;
  const label = status === "idle" ? (last?.runLabel ?? null) : runLabel;
  if (!shown || shown === "idle") return null;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-[11px] leading-4 font-normal text-muted-foreground",
        shown === "failed" && "text-destructive",
      )}
    >
      {isRunActive(shown) ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-foreground motion-safe:animate-pulse"
        />
      ) : null}
      <span className="shrink-0">{runStatusLabel(shown, [])}</span>
      {label ? (
        <span className="min-w-0 truncate" title={label}>
          · {label}
        </span>
      ) : null}
    </span>
  );
};

const TitleEditor = ({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (title: string | null) => void;
}) => {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDone(null);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  return (
    <input
      autoFocus
      aria-label="Chat title"
      defaultValue={initial}
      maxLength={80}
      spellCheck={false}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(event) => onDone(event.currentTarget.value)}
      className="h-7 min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 text-[13px] font-medium outline-none"
    />
  );
};

/**
 * Agent panel header: chat title with a chevron (opens the file's chats), the run status under
 * it, and "+" for a new chat. Double-click the title to rename.
 */
export const SessionHeader = () => {
  const title = useAgentStore(liveTitle);
  const sessionId = useAgentStore((s) => s.sessionId);
  const hasTurns = useAgentStore((s) => s.turns.length > 0 || s.log.length > 0);
  const busy = useAgentStore((s) => isRunActive(s.status));
  const isEmpty = useAgentStore((s) => s.turns.length === 0 && s.log.length === 0);
  const items = useSessionsStore((s) => s.items);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const addDisabled = busy || isEmpty;
  const addHint = busy
    ? "Stop the current run to start a new chat"
    : isEmpty
      ? "This chat is empty"
      : "New chat";

  return (
    <PanelHeader className="gap-1 pr-2">
      {editing ? (
        <TitleEditor
          initial={title}
          onDone={(next) => {
            setEditing(false);
            if (next !== null && next.trim() !== title) void renameSession(sessionId, next);
          }}
        />
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            aria-label={`Chats, current: ${title}`}
            title={hasTurns ? "Double-click to rename" : undefined}
            onDoubleClick={() => {
              if (!hasTurns) return;
              setOpen(false);
              setEditing(true);
            }}
            className="-ml-1.5 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate leading-4">{title}</span>
              <RunStatusLine />
            </span>
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <SessionList
              items={items}
              activeId={sessionId}
              busy={busy}
              onPick={(id) => {
                setOpen(false);
                void switchSession(id);
              }}
              onDelete={(id) => void removeSession(id)}
            />
          </PopoverContent>
        </Popover>
      )}
      <Tooltip content={addHint} side="bottom">
        <button
          type="button"
          aria-label="New chat"
          aria-disabled={addDisabled}
          onClick={() => {
            if (!addDisabled) void startNewSession();
          }}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,opacity,scale] duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring/50",
            addDisabled
              ? "cursor-default opacity-50"
              : "hover:bg-accent hover:text-foreground motion-safe:active:scale-[.97]",
          )}
        >
          <PlusIcon aria-hidden className="size-4" />
        </button>
      </Tooltip>
    </PanelHeader>
  );
};
