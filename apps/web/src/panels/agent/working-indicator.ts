import type { RunStatus, RunStep } from "@/agent/use-agent-store";

/** Label for the "agent is working" row; step math counts from the steps array. */
export const workingLabel = (status: RunStatus, steps: readonly RunStep[]): string => {
  if (status === "planning") return "Planning…";
  if (status === "awaiting_decision") return "Waiting for your choice";
  const index = steps.findIndex((step) => step.status === "running");
  const current = steps[index];
  if (!current) return "Designing…";
  return `Designing · step ${index + 1} of ${steps.length} — ${current.title}`;
};

/** mm:ss (or h:mm:ss past an hour). Negative / NaN clamp to 0. */
export const formatElapsed = (ms: number): string => {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
};

/** Run start: the first log entry when present, otherwise the fallback (mount time). */
/** Log entries older than this cannot belong to the current run (stale or bogus timestamps). */
const MAX_RUN_AGE_MS = 12 * 60 * 60 * 1000;

export const runStartedAt = (firstLogAt: number | undefined, fallback: number): number =>
  firstLogAt === undefined || fallback - firstLogAt > MAX_RUN_AGE_MS
    ? fallback
    : Math.min(firstLogAt, fallback);
