import { describe, expect, test } from "bun:test";
import type { LocalAgentInfo } from "@pego/agent";
import type { RunStep } from "@/agent/use-agent-store";
import {
  agentDetail,
  agentStatus,
  AGENT_PROVIDER,
  noteCommand,
  pillModel,
  pillTitle,
  customModelCandidate,
  filterModels,
  INSTALL_HINTS,
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

  const codex: LocalAgentInfo = {
    id: "codex",
    name: "Codex",
    installed: true,
    supportsModels: true,
  };

  test("agentStatus covers bridge down, not installed, version and note", () => {
    expect(agentStatus(codex, false)).toEqual({
      tone: "off",
      label: "Bridge not running",
      selectable: true,
    });
    expect(agentStatus(undefined, true).label).toBe("Bridge not running");
    expect(agentStatus({ ...codex, installed: false }, true)).toEqual({
      tone: "off",
      label: "Not installed",
      selectable: false,
    });
    expect(agentStatus({ ...codex, version: "1.2.3" }, true)).toEqual({
      tone: "ready",
      label: "v1.2.3",
      selectable: true,
    });
    expect(agentStatus({ ...codex, version: "v2" }, true).label).toBe("v2");
    expect(agentStatus(codex, true).label).toBe("Installed");
    expect(agentStatus({ ...codex, note: "Run `codex login`" }, true).tone).toBe("warn");
  });

  test("agentDetail shows install hint or note", () => {
    expect(agentDetail("codex", { ...codex, installed: false }, true)).toBe(
      `Install: ${INSTALL_HINTS.codex}`,
    );
    expect(agentDetail("codex", { ...codex, installed: false, note: "n" }, true)).toBe("n");
    expect(agentDetail("codex", { ...codex, note: "Run `codex login`" }, true)).toBe(
      "Run `codex login`",
    );
    expect(agentDetail("codex", codex, true)).toBeNull();
    expect(agentDetail("codex", codex, false)).toBeNull();
  });

  test("filterModels matches all terms case-insensitively", () => {
    const models = ["anthropic/claude-sonnet-4", "openai/gpt-5", "openai/gpt-4o"];
    expect(filterModels(models, "")).toEqual(models);
    expect(filterModels(models, "GPT")).toEqual(["openai/gpt-5", "openai/gpt-4o"]);
    expect(filterModels(models, "openai 4o")).toEqual(["openai/gpt-4o"]);
    expect(filterModels(models, "zzz")).toEqual([]);
  });

  test("customModelCandidate skips empty and known ids", () => {
    expect(customModelCandidate(["a"], "  ")).toBeNull();
    expect(customModelCandidate(["a"], "a")).toBeNull();
    expect(customModelCandidate(["a"], " my/model ")).toBe("my/model");
  });

  test("noteCommand extracts the first backtick command", () => {
    expect(noteCommand("Run `codex login` once")).toBe("codex login");
    expect(noteCommand("Not signed in")).toBeNull();
    expect(noteCommand(undefined)).toBeNull();
  });

  test("pillModel falls back to a muted Default", () => {
    expect(pillModel(undefined)).toEqual({ label: "Default", isDefault: true });
    expect(pillModel(null).isDefault).toBe(true);
    expect(pillModel("  ").isDefault).toBe(true);
    expect(pillModel("default").isDefault).toBe(true);
    expect(pillModel("gpt-5")).toEqual({ label: "gpt-5", isDefault: false });
  });

  test("pillTitle joins agent and model", () => {
    expect(pillTitle("Codex", pillModel("gpt-5"))).toBe("Codex · gpt-5");
    expect(pillTitle("Codex", pillModel(undefined))).toBe("Codex · Default");
  });

  test("every local agent has a provider", () => {
    expect(AGENT_PROVIDER["claude-code"]).toBe("anthropic");
    expect(AGENT_PROVIDER.codex).toBe("openai");
    expect(Object.keys(AGENT_PROVIDER)).toHaveLength(6);
  });
});
