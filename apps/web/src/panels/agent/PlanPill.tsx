import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, CircleXIcon } from "lucide-react";
import { Spinner } from "@pego/ui/components/spinner";
import { cn } from "@pego/ui/lib/utils";
import { useVisibleRun } from "@/agent/use-agent-store";
import { PlanList } from "@/panels/agent/PlanList";
import {
  planPillText,
  planPillTone,
  planProgressLabel,
  type PlanPillTone,
} from "@/panels/agent/plan-pill";

const TONE_CLASS: Record<PlanPillTone, string> = {
  running: "text-violet-text",
  idle: "text-muted-foreground",
  done: "text-success",
  awaiting: "text-warning",
  failed: "text-destructive",
};

const ToneIcon = ({ tone }: { tone: PlanPillTone }) => {
  switch (tone) {
    case "running":
      return (
        <Spinner
          role="presentation"
          aria-label={undefined}
          aria-hidden
          className="size-3 text-violet"
        />
      );
    case "done":
      return <CheckIcon aria-hidden className="size-3.5 shrink-0" />;
    case "awaiting":
      return <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />;
    case "failed":
      return <CircleXIcon aria-hidden className="size-3.5 shrink-0" />;
    case "idle":
      return null;
  }
};

/**
 * Floating plan summary anchored top-right of the run area. Collapsed: tone icon, "2/4" and the
 * current step. Expanded: the step list in a card below. Collapses again when a new run starts.
 */
export const PlanPill = () => {
  const steps = useVisibleRun((s) => s.steps);
  const status = useVisibleRun((s) => s.status);
  const runId = useVisibleRun((s) => s.runId);
  const [open, setOpen] = useState(false);
  const [seenRun, setSeenRun] = useState(runId);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  if (seenRun !== runId) {
    setSeenRun(runId);
    setOpen(false);
  }

  if (steps.length === 0) return null;

  const tone = planPillTone(status, steps);
  const progress = planProgressLabel(steps);
  const text = planPillText(status, steps);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="pointer-events-none absolute top-2 right-3 left-3 z-10 flex animate-[pego-fade-in_var(--duration-base)_var(--ease-out)] flex-col items-end gap-1.5"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Plan, ${progress} steps done. ${text}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "pointer-events-auto flex h-7 max-w-[min(13rem,70%)] items-center gap-1.5 rounded-full border bg-popover pr-2 pl-2.5 font-mono text-xs shadow-sm outline-none",
          "transition-[background-color,color,scale] duration-(--duration-fast) ease-out hover:bg-accent focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]",
          TONE_CLASS[tone],
        )}
      >
        <ToneIcon tone={tone} />
        <span className="font-medium tabular-nums">{progress}</span>
        <span className="min-w-0 truncate text-muted-foreground">{text}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-out",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          id={panelId}
          className="pointer-events-auto max-h-72 w-72 origin-top-right animate-[pego-pop-in_var(--duration-fast)_var(--ease-out)] max-w-full overflow-y-auto overscroll-contain rounded-xl shadow-md"
        >
          <PlanList steps={steps} />
        </div>
      ) : null}
    </div>
  );
};
