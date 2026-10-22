/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { getActiveRun } from "./active-run";
import { startCustomRun, type CustomRunDeps } from "./run";
import { resetStores } from "./test-utils";
import type { CustomProvider } from "./providers/types";
import { useAgentStore } from "./use-agent-store";

beforeEach(resetStores);

const provider = (over: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "p1",
  name: "Gateway",
  kind: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  models: ["m1", "m2"],
  executorModel: "m1",
  createdAt: 1,
  ...over,
});

type Calls = { openai: unknown[]; anthropic: unknown[] };

const fakeDeps = (p: CustomProvider | undefined, key: string | null) => {
  const calls: Calls = { openai: [], anthropic: [] };
  const deps: CustomRunDeps = {
    listProviders: async () => (p ? [p] : []),
    loadKey: async () => key,
    runOpenAi: async (prompt, ctx) => {
      calls.openai.push({ prompt, ctx, active: getActiveRun()?.backend });
    },
    runAnthropic: async (prompt, ctx) => {
      calls.anthropic.push({ prompt, ctx, active: getActiveRun()?.backend });
    },
  };
  return { deps, calls };
};

const run = (deps: CustomRunDeps) => startCustomRun("run-1", "make a card", "skill-x", deps);

const state = () => useAgentStore.getState();
const lastError = () =>
  state()
    .log.filter((l) => l.kind === "error")
    .at(-1)?.text;

describe("custom provider dispatch", () => {
  beforeEach(() => state().setCustomProvider("p1"));

  test("openai-compatible runs the OpenAI runtime with provider, key and skill", async () => {
    const { deps, calls } = fakeDeps(provider(), "sk-test");
    await run(deps);
    expect(calls.anthropic).toHaveLength(0);
    const [call] = calls.openai as {
      prompt: string;
      ctx: Record<string, unknown>;
      active: string;
    }[];
    expect(call?.prompt).toBe("make a card");
    expect(call?.ctx).toMatchObject({
      provider: { id: "p1" },
      apiKey: "sk-test",
      skillId: "skill-x",
    });
    expect(call?.active).toBe("custom");
    expect(getActiveRun()).toBeNull(); // cleared after the run
    expect(state().runLabel).toBe("Gateway · m1");
  });

  test("anthropic-compatible runs the Anthropic loop in compat mode with planner/executor ids", async () => {
    const p = provider({
      kind: "anthropic-compatible",
      plannerModel: "big",
      executorModel: "small",
    });
    const { deps, calls } = fakeDeps(p, "sk-test");
    await run(deps);
    expect(calls.openai).toHaveLength(0);
    const [call] = calls.anthropic as { ctx: { provider: Record<string, unknown> } }[];
    expect(call?.ctx.provider).toEqual({
      baseUrl: p.baseUrl,
      apiKey: "sk-test",
      plannerModel: "big",
      executorModel: "small",
      compat: true,
      name: "Gateway",
    });
  });

  test("planner falls back to the executor model", async () => {
    const { deps, calls } = fakeDeps(provider({ kind: "anthropic-compatible" }), "k");
    await run(deps);
    const [call] = calls.anthropic as { ctx: { provider: { plannerModel: string } } }[];
    expect(call?.ctx.provider.plannerModel).toBe("m1");
  });

  test("a deleted provider ends the run with a clear error", async () => {
    const { deps, calls } = fakeDeps(undefined, "k");
    await run(deps);
    expect(state().status).toBe("failed");
    expect(lastError()).toContain("no longer exists");
    expect(calls.openai.length + calls.anthropic.length).toBe(0);
  });

  test("a missing key fails for a remote provider, never calling a runtime", async () => {
    const { deps, calls } = fakeDeps(provider(), null);
    await run(deps);
    expect(state().status).toBe("failed");
    expect(lastError()).toContain("No API key set for Gateway");
    expect(calls.openai.length).toBe(0);
  });

  test("localhost providers run without a key", async () => {
    const { deps, calls } = fakeDeps(provider({ baseUrl: "http://localhost:11434/v1" }), null);
    await run(deps);
    expect(calls.openai).toHaveLength(1);
    expect((calls.openai[0] as { ctx: { apiKey: string } }).ctx.apiKey).toBe("");
  });

  test("a failing key lookup is treated as no key", async () => {
    const { deps } = fakeDeps(provider(), "k");
    deps.loadKey = async () => {
      throw new Error("idb blocked");
    };
    await run(deps);
    expect(lastError()).toContain("No API key set");
  });
});
