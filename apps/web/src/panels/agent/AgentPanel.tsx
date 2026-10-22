import { useState } from "react";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { ActivityLog } from "@/panels/agent/ActivityLog";
import { AgentComposer } from "@/panels/agent/AgentComposer";
import { AgentEmptyState } from "@/panels/agent/AgentEmptyState";
import { ChangesBar } from "@/panels/agent/ChangesBar";
import { DecisionCard } from "@/panels/agent/DecisionCard";
import { PlanPill } from "@/panels/agent/PlanPill";
import { WorkingIndicator } from "@/panels/agent/WorkingIndicator";
import {
  formatUsage,
  isRunActive,
  isRunFinished,
  runStatusLabel,
} from "@/panels/agent/agent-format";

const RunHeader = () => {
  const status = useAgentStore((s) => s.status);
  const runLabel = useAgentStore((s) => s.runLabel);
  const active = isRunActive(status);
  return (
    <PanelHeader>
      {status === "idle" ? (
        <span className="truncate">Agent</span>
      ) : (
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            status === "failed" && "text-destructive",
          )}
        >
          {active ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground"
            />
          ) : null}
          <span className="shrink-0">{runStatusLabel(status, [])}</span>
          {runLabel ? (
            <span className="min-w-0 truncate font-normal text-muted-foreground" title={runLabel}>
              · {runLabel}
            </span>
          ) : null}
        </span>
      )}
    </PanelHeader>
  );
};

const RunView = () => {
  const log = useAgentStore((s) => s.log);
  const usage = useAgentStore((s) => s.usage);
  const showUsage = usage.inputTokens + usage.outputTokens > 0 || usage.costUsd > 0;

  return (
    <div className="flex flex-col gap-3">
      <ActivityLog log={log} />
      <WorkingIndicator />
      {showUsage ? (
        <p className="px-1 text-[11px] text-muted-foreground tabular-nums">{formatUsage(usage)}</p>
      ) : null}
    </div>
  );
};

export const AgentPanel = () => {
  const hasRun = useAgentStore(
    (s) => s.status !== "idle" || s.log.length > 0 || s.steps.length > 0,
  );
  const decision = useAgentStore((s) => s.decision);
  const status = useAgentStore((s) => s.status);
  const hasPlan = useAgentStore((s) => s.steps.length > 0);
  const [seed, setSeed] = useState({ text: "", key: 0 });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RunHeader />
      <div className="relative min-h-0 flex-1">
        <div className={cn("h-full overflow-y-auto px-3 pb-3", hasPlan ? "pt-12" : "pt-3")}>
          {hasRun ? (
            <RunView />
          ) : (
            <AgentEmptyState onPick={(text) => setSeed((prev) => ({ text, key: prev.key + 1 }))} />
          )}
        </div>
        {hasPlan ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-background from-65% to-transparent"
          />
        ) : null}
        <PlanPill />
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {decision ? <DecisionCard decision={decision} /> : null}
        {isRunFinished(status) ? <ChangesBar /> : null}
        <AgentComposer seed={seed} />
      </div>
    </div>
  );
};
