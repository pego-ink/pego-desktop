import {
  CircleCheckIcon,
  CircleIcon,
  CircleSlashIcon,
  CircleXIcon,
  PauseCircleIcon,
} from "lucide-react";
import { Spinner } from "@pego/ui/components/spinner";
import { cn } from "@pego/ui/lib/utils";
import type { RunStep } from "@/agent/use-agent-store";
import { useVisibleRun } from "@/agent/use-agent-store";
import {
  countDoneSteps,
  STEP_ICON_LABEL,
  stepIconKind,
  type StepIconKind,
} from "@/panels/agent/agent-format";

const ICON_CLASS: Record<StepIconKind, string> = {
  pending: "text-subtle-foreground",
  running: "text-violet",
  done: "text-success",
  failed: "text-destructive",
  skipped: "text-subtle-foreground",
};

const StepIcon = ({ kind, waiting }: { kind: StepIconKind; waiting: boolean }) => {
  const className = cn("size-4 shrink-0", ICON_CLASS[kind]);
  switch (kind) {
    case "pending":
      return <CircleIcon className={className} />;
    case "running":
      if (waiting) return <PauseCircleIcon className={cn(className, "text-warning")} />;
      return (
        <Spinner
          role="presentation"
          aria-label={undefined}
          aria-hidden
          className={cn("m-[1px] size-3.5", ICON_CLASS.running)}
        />
      );
    case "done":
      return <CircleCheckIcon className={className} />;
    case "failed":
      return <CircleXIcon className={className} />;
    case "skipped":
      return <CircleSlashIcon className={className} />;
  }
};

const StepRow = ({ step, waiting }: { step: RunStep; waiting: boolean }) => {
  const kind = stepIconKind(step.status);
  const note = step.summary ?? (kind === "running" ? step.detail : undefined);
  return (
    <li
      data-status={step.status}
      aria-label={`${step.title}, ${STEP_ICON_LABEL[step.status]}`}
      className="px-1 py-1"
    >
      <div className="flex items-center gap-2">
        <StepIcon kind={kind} waiting={waiting} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            kind === "running" && "font-semibold text-foreground",
            kind === "done" && "text-foreground",
            (kind === "pending" || kind === "skipped") && "text-subtle-foreground",
            kind === "failed" && "text-foreground",
            kind === "skipped" && "line-through",
          )}
          title={step.title}
        >
          {step.title}
        </span>
      </div>
      {note ? (
        <p
          className={cn(
            "mt-0.5 pl-6 text-xs leading-4",
            kind === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      ) : null}
    </li>
  );
};

/** The plan card: "PLAN" label, `done / total` counter and the steps. */
export const PlanList = ({ steps }: { steps: readonly RunStep[] }) => {
  const awaiting = useVisibleRun((s) => s.status === "awaiting_decision");
  const done = countDoneSteps(steps);
  const allDone = steps.length > 0 && done === steps.length;
  return (
    <div className={cn("rounded-xl border bg-muted p-3", allDone && "border-success/40")}>
      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] tracking-wider uppercase">
        <span className="text-subtle-foreground">Plan</span>
        <span className="text-violet-text tabular-nums">
          {done} / {steps.length}
        </span>
      </div>
      <ul className="flex flex-col" aria-label="Plan">
        {steps.map((step) => (
          <StepRow key={step.id} step={step} waiting={awaiting} />
        ))}
      </ul>
    </div>
  );
};
