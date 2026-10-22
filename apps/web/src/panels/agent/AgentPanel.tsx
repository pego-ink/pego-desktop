import { useEffect, useState } from "react";
import { ArrowDownIcon } from "lucide-react";
import { Reveal } from "@pego/ui/components/reveal";
import { cn } from "@pego/ui/lib/utils";
import type { TurnUsage } from "@/agent/sessions/session-model";
import { useVisibleRun, type AgentLogEntry } from "@/agent/use-agent-store";
import { ActivityLog } from "@/panels/agent/ActivityLog";
import { AgentComposer } from "@/panels/agent/AgentComposer";
import { AgentEmptyState } from "@/panels/agent/AgentEmptyState";
import { ChangesBar } from "@/panels/agent/ChangesBar";
import { DecisionCard } from "@/panels/agent/DecisionCard";
import { QueuedMessages } from "@/panels/agent/QueuedMessages";
import { PlanPill } from "@/panels/agent/PlanPill";
import { SessionHeader } from "@/panels/agent/SessionHeader";
import { WorkingIndicator } from "@/panels/agent/WorkingIndicator";
import { usePinnedScroll } from "@/panels/agent/use-pinned-scroll";
import { formatUsage, isRunActive, isRunFinished } from "@/panels/agent/agent-format";

/** One run of the session: prompt, activity, reply and usage, exactly as a single run looked before. */
const TurnView = ({
  log,
  usage,
  latest,
}: {
  log: readonly AgentLogEntry[];
  usage: TurnUsage;
  /** The newest run: the one that can be working right now. */
  latest: boolean;
}) => {
  const active = useVisibleRun((s) => latest && isRunActive(s.status));
  const showUsage = usage.inputTokens + usage.outputTokens > 0 || usage.costUsd > 0;
  return (
    <div className="flex flex-col gap-3">
      <ActivityLog log={log} active={active} />
      {latest ? <WorkingIndicator /> : null}
      {showUsage ? (
        <p className="px-1 text-[11px] text-muted-foreground tabular-nums">{formatUsage(usage)}</p>
      ) : null}
    </div>
  );
};

/** The whole session in order: earlier turns, then the latest run (which is live in the store). */
const RunView = () => {
  const turns = useVisibleRun((s) => s.turns);
  const runId = useVisibleRun((s) => s.runId);
  const log = useVisibleRun((s) => s.log);
  const usage = useVisibleRun((s) => s.usage);
  const showLatest = runId !== null && log.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {turns.map((turn) => (
        <TurnView key={turn.runId} log={turn.log} usage={turn.usage} latest={false} />
      ))}
      {showLatest ? <TurnView key={runId} log={log} usage={usage} latest /> : null}
    </div>
  );
};

export const AgentPanel = () => {
  const hasRun = useVisibleRun(
    (s) => s.status !== "idle" || s.log.length > 0 || s.steps.length > 0 || s.turns.length > 0,
  );
  const decision = useVisibleRun((s) => s.decision);
  const status = useVisibleRun((s) => s.status);
  const hasPlan = useVisibleRun((s) => s.steps.length > 0);
  const hasChanges = useVisibleRun((s) => s.transactionCount > 0 || s.focusIds.length > 0);
  const logCount = useVisibleRun((s) => s.log.length);
  const lastKind = useVisibleRun((s) => s.log[s.log.length - 1]?.kind);
  const runId = useVisibleRun((s) => s.runId);
  const [seed, setSeed] = useState({ text: "", key: 0 });
  const { containerRef, contentRef, pinned, follow, jumpToLatest, scrollProps } = usePinnedScroll();

  // A new entry follows smoothly when pinned; the user's own message always scrolls to the bottom.
  useEffect(() => {
    if (logCount > 0) follow(lastKind === "user");
  }, [logCount, lastKind, runId, follow]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionHeader />
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
        <QueuedMessages />
        <AgentComposer seed={seed} />
      </div>
    </div>
  );
};
