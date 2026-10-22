import { useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
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
import { useSessionsStore } from "@/agent/sessions/use-sessions-store";
import { liveTitle, runningSessions, useAgentStore, useVisibleRun } from "@/agent/use-agent-store";
import { SessionList } from "@/panels/agent/SessionList";
import { isRunActive } from "@/panels/agent/agent-format";

/** Small pulsing dot next to the title while the chat's run is working (no text, no backend). */
const RunningDot = () => {
  const active = useVisibleRun((s) => isRunActive(s.status));
  if (!active) return null;
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 rounded-full bg-foreground motion-safe:animate-pulse"
    />
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
 * Agent panel header on one line: chat title with a chevron (opens the file's chats), a pulsing
 * dot while its run works, and "+" for a new chat. Double-click the title to rename.
 */
export const SessionHeader = () => {
  const title = useVisibleRun(liveTitle);
  const sessionId = useAgentStore((s) => s.visibleSessionId);
  const hasTurns = useVisibleRun((s) => s.turns.length > 0 || s.log.length > 0);
  const isEmpty = useVisibleRun((s) => s.turns.length === 0 && s.log.length === 0);
  // Chats with a working run (this one or in the background) get a running mark in the list.
  const runningIds = useAgentStore(useShallow((s) => runningSessions(s).map((live) => live.id)));
  const items = useSessionsStore((s) => s.items);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  // A running chat keeps going in the background, so a new one can start any time.
  const addDisabled = isEmpty;
  const addHint = isEmpty ? "This chat is empty" : "New chat";

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
            <span className="min-w-0 truncate leading-4">{title}</span>
            <RunningDot />
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent className="w-72" align="start">
            <SessionList
              items={items}
              activeId={sessionId}
              runningIds={runningIds}
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
