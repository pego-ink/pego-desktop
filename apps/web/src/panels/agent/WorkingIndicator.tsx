import { useEffect, useState } from "react";
import { useAgentStore } from "@/agent/use-agent-store";
import { isRunActive } from "@/panels/agent/agent-format";
import { formatElapsed, runStartedAt, workingLabel } from "@/panels/agent/working-indicator";

const KEYFRAMES = `
@keyframes pego-working-cursor {
  0%, 100% { transform: translate(1px, 2px); }
  45%, 60% { transform: translate(9px, 8px); }
}
@keyframes pego-working-box {
  0%, 35% { stroke-dashoffset: 0; opacity: .35; }
  60%, 100% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .pego-working-cursor, .pego-working-box { animation: none !important; }
}`;

/** A cursor arrow nudging a rectangle: a designer at work. Static under reduced motion. */
const DesignerGlyph = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 text-foreground">
    <style>{KEYFRAMES}</style>
    <rect
      x="8"
      y="9"
      width="9"
      height="7"
      rx="1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="pego-working-box"
      style={{ animation: "pego-working-box 2.4s ease-in-out infinite" }}
    />
    <g
      className="pego-working-cursor"
      style={{ animation: "pego-working-cursor 2.4s ease-in-out infinite" }}
    >
      <path d="M2 1.5 L2 11 L4.6 8.6 L6.4 12.5 L8 11.8 L6.2 8 L9.5 8 Z" fill="currentColor" />
    </g>
  </svg>
);

const Elapsed = ({ since }: { since: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
      {formatElapsed(now - since)}
    </span>
  );
};

const ActiveIndicator = () => {
  const status = useAgentStore((s) => s.status);
  const steps = useAgentStore((s) => s.steps);
  const runLabel = useAgentStore((s) => s.runLabel);
  const firstLogAt = useAgentStore((s) => s.log[0]?.at);
  const [mountedAt] = useState(() => Date.now());
  const label = workingLabel(status, steps);

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <DesignerGlyph />
      <div className="flex min-w-0 flex-1 flex-col">
        <span aria-live="polite" className="truncate text-xs font-medium" title={label}>
          {label}
        </span>
        {runLabel ? (
          <span className="truncate text-[11px] text-muted-foreground" title={runLabel}>
            {runLabel}
          </span>
        ) : null}
      </div>
      <Elapsed since={runStartedAt(firstLogAt, mountedAt)} />
    </div>
  );
};

export const WorkingIndicator = () => {
  const runId = useAgentStore((s) => s.runId);
  const active = useAgentStore((s) => isRunActive(s.status));
  return active ? <ActiveIndicator key={runId ?? "run"} /> : null;
};
