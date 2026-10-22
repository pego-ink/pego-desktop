import { useState, type KeyboardEvent } from "react";
import { Trash2Icon } from "lucide-react";
import { Input } from "@pego/ui/components/input";
import { cn } from "@pego/ui/lib/utils";
import type { SessionMeta } from "@/agent/sessions/session-model";
import { navigateList } from "@/panels/agent/list-nav";
import { filterSessions, formatRelativeTime } from "@/panels/agent/session-format";

type SessionListProps = {
  items: readonly SessionMeta[];
  activeId: string;
  /** A run is active: switching is off, the open session stays selectable. */
  busy: boolean;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
};

const rowButton =
  "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:bg-accent focus-visible:transition-none disabled:pointer-events-none disabled:opacity-50";

/** Search + list of a file's chats: arrows move focus, Enter opens, Delete asks to remove. */
export const SessionList = ({ items, activeId, busy, onPick, onDelete }: SessionListProps) => {
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const matches = filterSessions(items, query);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = matches.find((item) => !busy || item.id === activeId);
    if (first) onPick(first.id);
  };

  return (
    <div className="grid gap-0.5" onKeyDown={navigateList}>
      <Input
        data-nav
        autoFocus
        aria-label="Search chats"
        placeholder="Search chats"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setConfirmId(null);
        }}
        onKeyDown={onSearchKeyDown}
        className="h-7 px-2 text-[13px] md:text-[13px]"
      />
      {busy ? (
        <p className="px-2 py-1 text-[11px] leading-4 text-muted-foreground">
          Stop the current run to switch chats.
        </p>
      ) : null}
      <div role="listbox" aria-label="Chats" className="max-h-64 overflow-y-auto">
        {matches.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {items.length === 0 ? "No saved chats yet" : "No chats match"}
          </p>
        ) : null}
        {matches.map((item) => {
          const active = item.id === activeId;
          if (confirmId === item.id) {
            return (
              <div
                key={item.id}
                className="flex h-8 items-center gap-1 rounded-md bg-accent pr-1 pl-2 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate">Delete this chat?</span>
                <button
                  data-nav
                  type="button"
                  autoFocus
                  onClick={() => setConfirmId(null)}
                  className="h-6 rounded-md px-2 text-xs outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Cancel
                </button>
                <button
                  data-nav
                  type="button"
                  onClick={() => {
                    setConfirmId(null);
                    onDelete(item.id);
                  }}
                  className="h-6 rounded-md bg-destructive px-2 text-xs text-white outline-none hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-destructive/40"
                >
                  Delete
                </button>
              </div>
            );
          }
          const deleteBlocked = busy && active;
          return (
            <div key={item.id} className="group/row relative flex items-center">
              <button
                data-nav
                type="button"
                role="option"
                aria-selected={active}
                disabled={busy && !active}
                title={busy && !active ? "Stop the current run to switch chats" : undefined}
                onClick={() => onPick(item.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Delete" && event.key !== "Backspace") return;
                  if (deleteBlocked) return;
                  event.preventDefault();
                  setConfirmId(item.id);
                }}
                className={rowButton}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    active ? "bg-foreground" : "bg-transparent",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span
                  className={cn(
                    "shrink-0 text-[11px] text-muted-foreground tabular-nums transition-opacity duration-(--duration-fast)",
                    !deleteBlocked && "group-focus-within/row:opacity-0 group-hover/row:opacity-0",
                  )}
                >
                  {formatRelativeTime(item.updatedAt, now)}
                </span>
              </button>
              {deleteBlocked ? null : (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Delete chat: ${item.title}`}
                  onClick={() => setConfirmId(item.id)}
                  className="absolute right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-(--duration-fast) outline-none group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-background hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <Trash2Icon aria-hidden className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
