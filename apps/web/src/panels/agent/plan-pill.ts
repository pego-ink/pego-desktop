import type { RunStatus, RunStep } from "@/agent/use-agent-store";
import { countDoneSteps, currentStepNumber } from "@/panels/agent/agent-format";

export type PlanPillTone = "running" | "awaiting" | "done" | "failed" | "idle";

/** Visual tone of the plan pill; run status wins, step states fill the gaps. */
export const planPillTone = (status: RunStatus, steps: readonly RunStep[]): PlanPillTone => {
  if (status === "awaiting_decision") return "awaiting";
  if (status === "failed" || steps.some((s) => s.status === "failed")) return "failed";
  if (status === "planning" || status === "running") return "running";
  if (steps.length > 0 && countDoneSteps(steps) === steps.length) return "done";
  if (status === "done") return "done";
  return "idle";
};

/** "2/4" progress: finished steps over total. */
export const planProgressLabel = (steps: readonly RunStep[]): string =>
  `${countDoneSteps(steps)}/${steps.length}`;

/** Text after the progress count: current step title while running, otherwise the outcome. */
export const planPillText = (status: RunStatus, steps: readonly RunStep[]): string => {
  const tone = planPillTone(status, steps);
  if (tone === "failed") return "Failed";
  if (tone === "awaiting") return "Needs your decision";
  if (tone === "done") return "Done";
  if (tone === "running") {
    if (status === "planning") return "Planning…";
    return steps[currentStepNumber(steps) - 1]?.title ?? "Working…";
  }
  return status === "cancelled" ? "Cancelled" : "Plan";
};
