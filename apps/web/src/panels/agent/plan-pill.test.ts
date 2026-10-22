import { describe, expect, it } from "bun:test";
import type { RunStatus, RunStep } from "@/agent/use-agent-store";
import { planPillText, planPillTone, planProgressLabel } from "@/panels/agent/plan-pill";

const step = (id: string, status: RunStep["status"], title = `Step ${id}`): RunStep =>
  ({ id, title, status }) as RunStep;

const steps = [step("1", "done"), step("2", "running"), step("3", "pending"), step("4", "pending")];

describe("planPillTone", () => {
  it("maps run status to a tone", () => {
    expect(planPillTone("running", steps)).toBe("running");
    expect(planPillTone("planning", [])).toBe("running");
    expect(planPillTone("awaiting_decision", steps)).toBe("awaiting");
    expect(planPillTone("failed", steps)).toBe("failed");
    expect(planPillTone("done", steps)).toBe("done");
    expect(planPillTone("cancelled", steps)).toBe("idle");
  });
  it("treats a failed step as failed and all-done as done", () => {
    expect(planPillTone("done", [step("1", "done"), step("2", "failed")])).toBe("failed");
    expect(planPillTone("idle" as RunStatus, [step("1", "done")])).toBe("done");
  });
});

describe("planProgressLabel", () => {
  it("counts done over total", () => {
    expect(planProgressLabel(steps)).toBe("1/4");
    expect(planProgressLabel([])).toBe("0/0");
  });
});

describe("planPillText", () => {
  it("shows the current step while running", () => {
    expect(planPillText("running", steps)).toBe("Step 2");
    expect(planPillText("planning", steps)).toBe("Planning…");
  });
  it("shows the outcome otherwise", () => {
    expect(planPillText("done", steps)).toBe("Done");
    expect(planPillText("failed", steps)).toBe("Failed");
    expect(planPillText("awaiting_decision", steps)).toBe("Needs your decision");
    expect(planPillText("cancelled", steps)).toBe("Cancelled");
  });
});
