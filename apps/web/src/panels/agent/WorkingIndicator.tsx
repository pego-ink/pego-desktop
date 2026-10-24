import { useEffect, useState } from "react";
import { SquareIcon } from "lucide-react";
import { Spinner } from "@pego/ui/components/spinner";
import { cancelRun } from "@/agent/run";
import { safely } from "@/panels/agent/run-actions";
import { useVisibleRun } from "@/agent/use-agent-store";
import { isRunActive } from "@/panels/agent/agent-format";
import { formatElapsed, runStartedAt, workingLabel } from "@/panels/agent/working-indicator";

const Elapsed = ({ since }: { since: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="shrink-0 font-mono text-xs text-violet-text tabular-nums">
      {formatElapsed(now - since)}
    </span>
  );
};

const ActiveIndicator = () => {
  const status = useVisibleRun((s) => s.status);
  const steps = useVisibleRun((s) => s.steps);
  const runId = useVisibleRun((s) => s.runId);
  const runLabel = useVisibleRun((s) => s.runLabel);
  const firstLogAt = useVisibleRun((s) => s.log[0]?.at);
  const [mountedAt] = useState(() => Date.now());
  const label = workingLabel(status, steps);

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-violet-soft px-3 py-2">
      <Spinner
        role="presentation"
        aria-label={undefined}
        aria-hidden
        className="size-4 text-violet"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          aria-live="polite"
          className="truncate text-[13px] font-semibold text-violet-text"
          title={label}
        >
          {label}
        </span>
        {runLabel ? (
          <span className="truncate text-xs text-muted-foreground" title={runLabel}>
            {runLabel}
          </span>
        ) : null}
      </div>
      <Elapsed since={runStartedAt(firstLogAt, mountedAt)} />
      {runId ? (
        <button
          type="button"
          aria-label="Stop run"
          title="Stop run"
          onClick={() => void safely(() => cancelRun(runId))}
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background/60 text-violet-text outline-none transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <SquareIcon aria-hidden className="size-3 fill-current" />
        </button>
      ) : null}
    </div>
  );
};

export const WorkingIndicator = () => {
  const runId = useVisibleRun((s) => s.runId);
  const active = useVisibleRun((s) => isRunActive(s.status));
  return active ? <ActiveIndicator key={runId ?? "run"} /> : null;
};
