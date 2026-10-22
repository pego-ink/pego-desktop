import { describe, expect, test } from "bun:test";
import type { RunStep } from "@/agent/use-agent-store";
import {
  countDoneSteps,
  currentStepNumber,
  formatCost,
  formatTokens,
  formatUsage,
  isRunActive,
  runStatusLabel,
  selectionHint,
  stepIconKind,
} from "./agent-format";

const step = (id: string, status: RunStep["status"]): RunStep => ({ id, title: id, status });

describe("agent-format", () => {
  test("stepIconKind maps every status", () => {
    for (const s of ["pending", "running", "done", "failed", "skipped"] as const)
      expect(stepIconKind(s)).toBe(s);
  });

  test("formatCost", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.1234)).toBe("$0.12");
  });

  test("formatTokens", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2000)).toBe("2k");
    expect(formatTokens(250_000)).toBe("250k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });

  test("formatUsage", () => {
    expect(formatUsage({ inputTokens: 1200, outputTokens: 300, costUsd: 0.05 })).toBe(
      "1.2k in · 300 out · $0.05",
    );
  });

  test("isRunActive", () => {
    expect(isRunActive("running")).toBe(true);
    expect(isRunActive("awaiting_decision")).toBe(true);
    expect(isRunActive("done")).toBe(false);
    expect(isRunActive("idle")).toBe(false);
  });

  test("step numbering and status label", () => {
    const steps = [step("a", "done"), step("b", "running"), step("c", "pending")];
    expect(currentStepNumber(steps)).toBe(2);
    expect(countDoneSteps(steps)).toBe(1);
    expect(runStatusLabel("running", steps)).toBe("Working on step 2 of 3");
    expect(runStatusLabel("running", [])).toBe("Working…");
    expect(currentStepNumber([step("a", "done")])).toBe(1);
  });

  test("selectionHint", () => {
    expect(selectionHint(0)).toBeNull();
    expect(selectionHint(1)).toBe("1 layer selected");
    expect(selectionHint(3)).toBe("3 layers selected");
  });
});
