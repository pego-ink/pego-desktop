import { useState } from "react";
import { SparklesIcon } from "lucide-react";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { ActivityLog } from "@/panels/agent/ActivityLog";
import { AgentComposer } from "@/panels/agent/AgentComposer";
import { AgentEmptyState } from "@/panels/agent/AgentEmptyState";
import { BackendSwitch } from "@/panels/agent/BackendSwitch";
import { ChangesBar } from "@/panels/agent/ChangesBar";
import { DecisionCard } from "@/panels/agent/DecisionCard";
import { PlanList } from "@/panels/agent/PlanList";
import {
  countDoneSteps,
  formatUsage,
  isRunActive,
  isRunFinished,
  runStatusLabel,
} from "@/panels/agent/agent-format";

// TODO(bridge): mount the bridge connection starter from "@/agent/bridge-client" once exported
// (call it once for the app lifetime, e.g. in a useEffect here or in EditorShell).

const RunHeader = () => {
  const status = useAgentStore((s) => s.status);
  const steps = useAgentStore((s) => s.steps);
  const prompt = useAgentStore((s) => s.prompt);
  const active = isRunActive(status);
  return (
    <PanelHeader className="h-auto min-h-11 flex-col items-start justify-center gap-0 py-1.5">
      <span className="w-full truncate" title={prompt || undefined}>
        {prompt || "Agent"}
      </span>
      {status === "idle" ? null : (
        <span
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-normal",
            status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {active ? (
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-foreground" />
          ) : null}
          {runStatusLabel(status, steps)}
        </span>
      )}
    </PanelHeader>
  );
};

const RunView = () => {
  const prompt = useAgentStore((s) => s.prompt);
  const steps = useAgentStore((s) => s.steps);
  const log = useAgentStore((s) => s.log);
  const status = useAgentStore((s) => s.status);
  const usage = useAgentStore((s) => s.usage);
  const done = countDoneSteps(steps);
  const showUsage = usage.inputTokens + usage.outputTokens > 0 || usage.costUsd > 0;

  return (
    <div className="flex flex-col gap-3">
      {prompt ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 whitespace-pre-wrap">
          {prompt}
        </p>
      ) : null}
      {steps.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium">
            <SparklesIcon className="size-3.5" />
            Pego Agent
            <span className="font-normal text-muted-foreground">
              {isRunFinished(status) || done > 0
                ? `${done}/${steps.length} done`
                : `${steps.length} steps`}
            </span>
          </h3>
          <PlanList steps={steps} />
        </section>
      ) : null}
      <ActivityLog log={log} />
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
  const [seed, setSeed] = useState({ text: "", key: 0 });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RunHeader />
      <BackendSwitch />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {hasRun ? (
          <RunView />
        ) : (
          <AgentEmptyState onPick={(text) => setSeed((prev) => ({ text, key: prev.key + 1 }))} />
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {decision ? <DecisionCard decision={decision} /> : null}
        {isRunFinished(status) ? <ChangesBar /> : null}
        <AgentComposer seed={seed} />
      </div>
    </div>
  );
};
