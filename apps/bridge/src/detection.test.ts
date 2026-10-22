import { describe, expect, test } from "bun:test";
import type { AgentAdapter } from "./agents/types";
import { createAgentDetector } from "./detection";

const adapter = (id: AgentAdapter["id"], overrides: Partial<AgentAdapter> = {}): AgentAdapter => ({
  id,
  name: id,
  supportsModels: true,
  detect: async () => ({ installed: true, version: "1" }),
  run: async () => undefined,
  ...overrides,
});

describe("createAgentDetector", () => {
  test("detects every adapter in parallel and keeps registry order", async () => {
    const started: string[] = [];
    const slow = (id: AgentAdapter["id"], ms: number) =>
      adapter(id, {
        detect: async () => {
          started.push(id);
          await Bun.sleep(ms);
          return { installed: true };
        },
      });
    const detector = createAgentDetector({
      adapters: [slow("claude-code", 60), slow("codex", 10), slow("opencode", 10)],
    });
    const t0 = Date.now();
    const agents = await detector.detectAll();
    expect(Date.now() - t0).toBeLessThan(150);
    expect(started).toEqual(["claude-code", "codex", "opencode"]);
    expect(agents.map((a) => a.id)).toEqual(["claude-code", "codex", "opencode"]);
    expect(agents[0]).toMatchObject({
      id: "claude-code",
      name: "claude-code",
      supportsModels: true,
    });
  });

  test("caches for the ttl, refreshes after it, and force bypasses the cache", async () => {
    let calls = 0;
    let now = 1000;
    const detector = createAgentDetector({
      adapters: [
        adapter("codex", {
          detect: async () => {
            calls++;
            return { installed: true };
          },
        }),
      ],
      ttlMs: 30_000,
      now: () => now,
    });
    await detector.detectAll();
    await detector.detectAll();
    expect(calls).toBe(1);
    now += 29_000;
    await detector.detectAll();
    expect(calls).toBe(1);
    now += 2_000;
    await detector.detectAll();
    expect(calls).toBe(2);
    await detector.detectAll(true);
    expect(calls).toBe(3);
  });

  test("concurrent callers share one in-flight detection", async () => {
    let calls = 0;
    const detector = createAgentDetector({
      adapters: [
        adapter("codex", {
          detect: async () => {
            calls++;
            await Bun.sleep(30);
            return { installed: true };
          },
        }),
      ],
    });
    await Promise.all([detector.detectAll(), detector.detectAll(), detector.detectAll()]);
    expect(calls).toBe(1);
  });

  test("a hanging adapter times out and a throwing adapter degrades without hurting the others", async () => {
    const detector = createAgentDetector({
      adapters: [
        adapter("claude-code"),
        adapter("codex", { detect: () => new Promise(() => undefined) }),
        adapter("opencode", {
          detect: async () => {
            throw new Error("boom");
          },
        }),
      ],
      timeoutMs: 40,
    });
    const agents = await detector.detectAll();
    expect(agents[0]).toMatchObject({ id: "claude-code", installed: true });
    expect(agents[1]).toMatchObject({
      id: "codex",
      installed: false,
      note: "Detection timed out.",
    });
    expect(agents[2]).toMatchObject({
      id: "opencode",
      installed: false,
      note: "Detection failed.",
    });
  });

  test("detect receives the child env (PATH extended, API keys removed)", async () => {
    let seen: Record<string, string> = {};
    const detector = createAgentDetector({
      adapters: [
        adapter("codex", {
          detect: async (env) => {
            seen = env;
            return { installed: false };
          },
        }),
      ],
      env: () => ({ PATH: "/x" }),
    });
    await detector.detectAll();
    expect(seen).toEqual({ PATH: "/x" });
  });
});

describe("listModels", () => {
  test("returns the adapter's models unchanged", async () => {
    const ids = ["aki/cbai/deepseek-v4.1-flash(high)", "deepseek/deepseek-flash", "m#variant"];
    const detector = createAgentDetector({
      adapters: [adapter("opencode", { listModels: async () => ids })],
    });
    expect(await detector.listModels("opencode")).toEqual({ models: ids });
  });

  test("reports unknown agents, adapters without listing, thrown errors and timeouts", async () => {
    const detector = createAgentDetector({
      adapters: [
        adapter("codex"),
        adapter("opencode", {
          listModels: async () => {
            throw new Error("opencode models failed");
          },
        }),
        adapter("gemini", { listModels: () => new Promise(() => undefined) }),
      ],
      modelsTimeoutMs: 40,
    });
    expect(await detector.listModels("cursor")).toEqual({
      models: [],
      error: 'Unknown agent "cursor".',
    });
    expect(await detector.listModels("codex")).toEqual({ models: [] });
    expect(await detector.listModels("opencode")).toEqual({
      models: [],
      error: "opencode models failed",
    });
    expect(await detector.listModels("gemini")).toEqual({
      models: [],
      error: "Listing models timed out.",
    });
  });
});
