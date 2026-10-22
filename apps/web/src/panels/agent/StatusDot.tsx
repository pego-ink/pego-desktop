import { cn } from "@pego/ui/lib/utils";
import type { AgentStatusTone } from "@/panels/agent/agent-format";

const TONE_CLASS: Record<AgentStatusTone, string> = {
  ready: "bg-emerald-400",
  warn: "bg-amber-400",
  off: "bg-muted-foreground/50",
};

export const StatusDot = ({ tone, className }: { tone: AgentStatusTone; className?: string }) => (
  <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone], className)} />
);
