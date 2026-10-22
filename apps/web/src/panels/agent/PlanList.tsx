import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { cn } from "@pego/ui/lib/utils";
import type { RunStep } from "@/agent/use-agent-store";
import { STEP_ICON_LABEL, stepIconKind, type StepIconKind } from "@/panels/agent/agent-format";

const ICON_CLASS: Record<StepIconKind, string> = {
  pending: "text-muted-foreground/60",
  running: "animate-spin text-foreground",
  done: "text-foreground",
  failed: "text-destructive",
  skipped: "text-muted-foreground/60",
};

const StepIcon = ({ kind }: { kind: StepIconKind }) => {
  const className = cn("size-4 shrink-0", ICON_CLASS[kind]);
  switch (kind) {
    case "pending":
      return <CircleDashedIcon className={className} />;
    case "running":
      return <LoaderCircleIcon className={className} />;
    case "done":
      return <CircleCheckIcon className={className} />;
    case "failed":
      return <CircleXIcon className={className} />;
    case "skipped":
      return <CircleSlashIcon className={className} />;
  }
};

const StepRow = ({ step }: { step: RunStep }) => {
  const kind = stepIconKind(step.status);
  const note = step.summary ?? (kind === "running" ? step.detail : undefined);
  return (
    <li
      data-status={step.status}
      aria-label={`${step.title}, ${STEP_ICON_LABEL[step.status]}`}
      className={cn("rounded-md px-2 py-1.5", kind === "running" && "bg-accent")}
    >
      <div className="flex items-center gap-2">
        <StepIcon kind={kind} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            kind === "running" || kind === "done" ? "text-foreground" : "text-muted-foreground",
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
            "mt-0.5 pl-6 text-[11px] leading-4",
            kind === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      ) : null}
    </li>
  );
};

export const PlanList = ({ steps }: { steps: readonly RunStep[] }) => (
  <ul className="flex flex-col gap-px" aria-label="Plan">
    {steps.map((step) => (
      <StepRow key={step.id} step={step} />
    ))}
  </ul>
);
