import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ImageIcon,
  PencilIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Reveal } from "@pego/ui/components/reveal";
import { cn } from "@pego/ui/lib/utils";
import { editQueued, removeQueued, steerQueued } from "@/agent/queue";
import { useAgentStore, useVisibleRun, type QueuedMessage } from "@/agent/use-agent-store";
import { isRunActive } from "@/panels/agent/agent-format";

/** Rows shown before the "+N more" expander. */
export const MAX_VISIBLE_QUEUED = 3;
/** Matches the Reveal height transition, so a removed row is dropped once it has collapsed. */
const EXIT_MS = 200;

const ROW_ACTION =
  "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color] duration-(--duration-fast) hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

type RowProps = {
  sessionId: string;
  message: QueuedMessage;
  /** A run is working: Steer reaches it. Otherwise Steer just sends the message now. */
  running: boolean;
};

const QueuedRow = ({ sessionId, message, running }: RowProps) => {
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);
  const label = message.displayText ?? message.text;
  const [draft, setDraft] = useState(label);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Mount collapsed, then open, so a new row glides in instead of popping.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (editing) editRef.current?.select();
  }, [editing]);

  const attachmentCount = message.attachments.length;
  const lostCount = attachmentCount === 0 ? (message.attachmentsMeta?.length ?? 0) : 0;

  const startEdit = () => {
    setDraft(label);
    setEditing(true);
  };
  const save = () => {
    setEditing(false);
    if (draft.trim() !== label) editQueued(sessionId, message.id, draft);
  };
  const remove = () => {
    setShown(false);
    setTimeout(() => removeQueued(sessionId, message.id), EXIT_MS);
  };

  const onEditKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  };

  return (
    <li>
      <Reveal show={shown} className="pb-1">
        <div className="group/queue relative flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
          {editing ? (
            <textarea
              ref={editRef}
              aria-label="Edit queued message"
              autoFocus
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onEditKey}
              onBlur={save}
              className="max-h-24 min-h-9 min-w-0 flex-1 resize-none bg-transparent text-xs leading-4 outline-none [field-sizing:content]"
            />
          ) : (
            <>
              <span className="line-clamp-2 min-w-0 flex-1 break-words leading-4" title={label}>
                {label}
              </span>
              {attachmentCount > 0 ? (
                <span
                  title={`${attachmentCount} image${attachmentCount === 1 ? "" : "s"} attached`}
                  className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
                >
                  <ImageIcon aria-hidden className="size-3" />
                  {attachmentCount}
                </span>
              ) : null}
              {lostCount > 0 ? (
                <span
                  title="The images of this message were not kept after reload. Only the text will be sent."
                  className="flex shrink-0 items-center gap-0.5 rounded-sm bg-destructive/10 px-1 text-[11px] text-destructive"
                >
                  <TriangleAlertIcon aria-hidden className="size-3" />
                  {lostCount} image{lostCount === 1 ? "" : "s"} lost
                </span>
              ) : null}
              <div className="absolute inset-y-0.5 right-0.5 flex items-center gap-0.5 rounded-md bg-muted px-0.5 opacity-0 transition-opacity duration-(--duration-fast) ease-out group-focus-within/queue:opacity-100 group-hover/queue:opacity-100">
                <button
                  type="button"
                  aria-label="Steer: send now"
                  title={running ? "Send to the running agent now" : "Send now"}
                  onClick={() => steerQueued(sessionId, message.id)}
                  className={ROW_ACTION}
                >
                  <ArrowRightIcon aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Edit queued message"
                  title="Edit"
                  onClick={startEdit}
                  className={ROW_ACTION}
                >
                  <PencilIcon aria-hidden className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Remove queued message"
                  title="Remove"
                  onClick={remove}
                  className={cn(ROW_ACTION, "hover:text-destructive")}
                >
                  <XIcon aria-hidden className="size-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </Reveal>
    </li>
  );
};

/** Messages waiting for the visible session's next run, right above the composer. */
export const QueuedMessages = () => {
  const sessionId = useAgentStore((s) => s.visibleSessionId);
  const queue = useVisibleRun((s) => s.queue);
  const running = useVisibleRun((s) => isRunActive(s.status));
  const [expanded, setExpanded] = useState(false);

  if (queue.length === 0) return null;
  const hidden = Math.max(0, queue.length - MAX_VISIBLE_QUEUED);
  const rows = expanded ? queue : queue.slice(0, MAX_VISIBLE_QUEUED);
  return (
    <div>
      <ul aria-label="Queued messages">
        {rows.map((message) => (
          <QueuedRow key={message.id} sessionId={sessionId} message={message} running={running} />
        ))}
      </ul>
      {hidden > 0 || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mb-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? (
            <ChevronUpIcon aria-hidden className="size-3" />
          ) : (
            <ChevronDownIcon aria-hidden className="size-3" />
          )}
          {expanded ? "Show less" : `+${hidden} more`}
        </button>
      ) : null}
    </div>
  );
};
