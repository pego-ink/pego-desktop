import { useEffect, useState } from "react";
import { ArrowDownIcon } from "lucide-react";
import { PanelHeader } from "@pego/ui/components/panel-header";
import { Reveal } from "@pego/ui/components/reveal";
import { cn } from "@pego/ui/lib/utils";
import { useAgentStore } from "@/agent/use-agent-store";
import { ActivityLog } from "@/panels/agent/ActivityLog";
import { AgentComposer } from "@/panels/agent/AgentComposer";
import { AgentEmptyState } from "@/panels/agent/AgentEmptyState";
import { ChangesBar } from "@/panels/agent/ChangesBar";
import { DecisionCard } from "@/panels/agent/DecisionCard";
import { PlanPill } from "@/panels/agent/PlanPill";
import { WorkingIndicator } from "@/panels/agent/WorkingIndicator";
import { usePinnedScroll } from "@/panels/agent/use-pinned-scroll";
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
              className="size-1.5 shrink-0 rounded-full bg-foreground motion-safe:animate-pulse"
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
  const hasChanges = useAgentStore((s) => s.transactionCount > 0 || s.focusIds.length > 0);
  const logCount = useAgentStore((s) => s.log.length);
  const lastKind = useAgentStore((s) => s.log[s.log.length - 1]?.kind);
  const [seed, setSeed] = useState({ text: "", key: 0 });
  const { containerRef, contentRef, pinned, follow, jumpToLatest, scrollProps } = usePinnedScroll();

  // A new entry follows smoothly when pinned; the user's own message always scrolls to the bottom.
  useEffect(() => {
    if (logCount > 0) follow(lastKind === "user");
  }, [logCount, lastKind, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RunHeader />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          {...scrollProps}
          className={cn(
            "h-full [overflow-anchor:auto] overflow-y-auto overscroll-contain px-3 pb-3",
            // Reserve the plan pill's room for the whole run so the content never jumps when it appears.
            hasRun || hasPlan ? "pt-12" : "pt-3",
          )}
        >
          <div ref={contentRef}>
            {hasRun ? (
              <RunView />
            ) : (
              <AgentEmptyState
                onPick={(text) => setSeed((prev) => ({ text, key: prev.key + 1 }))}
              />
            )}
          </div>
        </div>
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-background from-65% to-transparent transition-opacity duration-(--duration-base) ease-out",
            hasPlan ? "opacity-100" : "opacity-0",
          )}
        />
        <PlanPill />
        <button
          type="button"
          inert={pinned || !hasRun}
          onClick={jumpToLatest}
          className={cn(
            "absolute bottom-3 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border bg-popover pr-2.5 pl-2 text-xs text-foreground shadow-md outline-none",
            "transition-[opacity,translate,scale,background-color] duration-(--duration-fast) ease-out hover:bg-accent focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-[.97]",
            pinned || !hasRun
              ? "pointer-events-none translate-y-1 opacity-0"
              : "translate-y-0 opacity-100",
          )}
        >
          <ArrowDownIcon aria-hidden className="size-3.5" />
          Jump to latest
        </button>
      </div>
      <div className="flex shrink-0 flex-col px-3 pb-3">
        <Reveal show={decision !== null} className="pb-2">
          {decision ? <DecisionCard key={decision.id} decision={decision} /> : null}
        </Reveal>
        <Reveal show={isRunFinished(status) && hasChanges} className="pb-2">
          <ChangesBar />
        </Reveal>
        <AgentComposer seed={seed} />
      </div>
    </div>
  );
};
