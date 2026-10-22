import { describe, expect, test } from "bun:test";
import type { RunStep } from "@/agent/use-agent-store";
import { formatElapsed, runStartedAt, workingLabel } from "./working-indicator";

const step = (id: string, status: RunStep["status"]): RunStep => ({ id, title: `T-${id}`, status });

describe("workingLabel", () => {
  test("planning and decision", () => {
    expect(workingLabel("planning", [])).toBe("Planning…");
    expect(workingLabel("awaiting_decision", [step("a", "running")])).toBe(
      "Waiting for your choice",
    );
  });
  test("running uses first running step index", () => {
    const steps = [
      step("a", "done"),
      step("b", "running"),
      step("c", "running"),
      step("d", "pending"),
    ];
    expect(workingLabel("running", steps)).toBe("Designing · step 2 of 4 — T-b");
  });
  test("running without a running step", () => {
    expect(workingLabel("running", [step("a", "done")])).toBe("Designing…");
    expect(workingLabel("running", [])).toBe("Designing…");
  });
});

describe("formatElapsed", () => {
  test("formats", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_900)).toBe("01:05");
    expect(formatElapsed(3_599_000)).toBe("59:59");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });
  test("clamps", () => {
    expect(formatElapsed(-5)).toBe("00:00");
    expect(formatElapsed(NaN)).toBe("00:00");
  });
});

describe("runStartedAt", () => {
  test("prefers earlier log time", () => {
    expect(runStartedAt(100, 500)).toBe(100);
    expect(runStartedAt(undefined, 500)).toBe(500);
  });
});

describe("runStartedAt guards", () => {
  test("ignores a first log entry older than 12h", () => {
    const now = 1_800_000_000_000;
    expect(runStartedAt(5, now)).toBe(now);
    expect(runStartedAt(now - 30_000, now)).toBe(now - 30_000);
  });
});
