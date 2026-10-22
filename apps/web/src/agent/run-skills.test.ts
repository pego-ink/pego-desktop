/// <reference types="bun" />
import { localRunConfig } from "./local-agent-run";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  EXECUTOR_SYSTEM,
  PLANNER_SYSTEM,
  skills,
  type EditorToBridge,
  type LocalAgentInfo,
  type Skill,
} from "@pego/agent";
import { runApiAgent, type MessagesClient } from "./api-runtime";
import { allRuns } from "./run-registry";
import { startLocalAgentRun } from "./local-agent-run";
import { startRun } from "./run";
import { resolveRunSkills, skillLogLines, skillPromptPrefix, skillsBlock } from "./run-skills";
import { resetStores, visible } from "./test-utils";
import { createToolHost } from "./tool-host";
import { emptyBridge, runScope, useAgentStore } from "./use-agent-store";

const fake = (id: string, title: string, over: Partial<Skill> = {}): Skill => ({
  id,
  title,
  description: `${title} skill`,
  keywords: [],
  content: `RULES-${id}`,
  checklist: [`CHECK-${id}`],
  styles: [],
  ...over,
});

const FAKES = [
  fake("fake-core", "Fake core", { core: true }),
  fake("fake-landing", "Fake landing", { keywords: ["zzfoo"] }),
  fake("fake-dash", "Fake dash", { keywords: ["zzbar"] }),
  fake("fakehaus", "Fakehaus", { category: "style" }),
  fake("fakeswiss", "Fakeswiss", { category: "style" }),
];

let added: Skill[] = [];
beforeEach(() => {
  localRunConfig.bridgeWaitMs = 0; // no bridge in tests: local runs fail fast instead of waiting
  resetStores();
  useAgentStore.getState().set({ selectedSkillId: undefined, selectedStyleId: undefined });
  added = [...FAKES];
  skills.unshift(...added);
});
afterEach(() => {
  for (const skill of added) skills.splice(skills.indexOf(skill), 1);
});

const state = () => useAgentStore.getState();

describe("resolveRunSkills", () => {
  test("auto picks core plus the best match; core-only when nothing matches", () => {
    expect(resolveRunSkills("buat zzfoo page").map((s) => s.id)).toEqual([
      "fake-core",
      "fake-landing",
    ]);
    expect(resolveRunSkills("qqq nothing").map((s) => s.id)).toEqual(["fake-core"]);
  });

  test("explicit choice wins, null means core only, unknown id is ignored", () => {
    expect(resolveRunSkills("buat zzfoo page", "fake-dash").map((s) => s.id)).toEqual([
      "fake-core",
      "fake-dash",
    ]);
    expect(resolveRunSkills("buat zzfoo page", null).map((s) => s.id)).toEqual(["fake-core"]);
    expect(resolveRunSkills("x", "nope").map((s) => s.id)).toEqual(["fake-core"]);
  });

  test("auto picks design and style together", () => {
    expect(resolveRunSkills("buat zzfoo page gaya fakehaus").map((s) => s.id)).toEqual([
      "fake-core",
      "fake-landing",
      "fakehaus",
    ]);
    // a style name alone gives a style without a design skill
    expect(resolveRunSkills("qqq fakeswiss").map((s) => s.id)).toEqual(["fake-core", "fakeswiss"]);
  });

  test("explicit style: string wins, null drops the auto style, wrong category ignored", () => {
    const run = (design: string | null | undefined, style: string | null | undefined) =>
      resolveRunSkills("zzfoo fakehaus", design, style).map((s) => s.id);
    expect(run(undefined, "fakeswiss")).toEqual(["fake-core", "fake-landing", "fakeswiss"]);
    expect(run(undefined, null)).toEqual(["fake-core", "fake-landing"]);
    expect(run(null, null)).toEqual(["fake-core"]);
    expect(run("fake-dash", undefined)).toEqual(["fake-core", "fake-dash", "fakehaus"]);
    expect(run("fakehaus", undefined)).toEqual(["fake-core", "fakehaus"]);
    expect(run(undefined, "fake-dash")).toEqual(["fake-core", "fake-landing"]);
  });

  test("the run's explicit style overrides the one detected in the prompt", () => {
    expect(resolveRunSkills("zzfoo fakehaus", undefined, "fakeswiss").map((s) => s.id)).toEqual([
      "fake-core",
      "fake-landing",
      "fakeswiss",
    ]);
  });

  test("the core skill is never listed twice", () => {
    expect(resolveRunSkills("x", "fake-core").map((s) => s.id)).toEqual(["fake-core"]);
  });
});

describe("skill text helpers", () => {
  test("block includes content and checklist; prefix lists ids; log names the chosen skill", () => {
    const picked = resolveRunSkills("buat zzfoo page");
    const block = skillsBlock(picked);
    expect(block).toContain("RULES-fake-landing");
    expect(block).toContain("- CHECK-fake-landing");
    expect(skillPromptPrefix(picked)).toBe(
      "Use Pego skills: fake-core, fake-landing (call get_skill). Reply and write design copy in the language of the request below.",
    );
    expect(skillLogLines(picked)).toEqual(["Using skill: Fake landing"]);
    expect(skillLogLines([FAKES[0] as Skill])).toEqual(["Using skill: Fake core"]);
    const both = resolveRunSkills("zzfoo fakehaus");
    expect(skillPromptPrefix(both)).toStartWith(
      "Use Pego skills: fake-core, fake-landing, fakehaus (call get_skill).",
    );
    expect(skillLogLines(both)).toEqual(["Using skill: Fake landing", "Using style: Fakehaus"]);
    expect(skillsBlock(both)).toContain("RULES-fakehaus");
    expect(skillsBlock([])).toBe("");
    expect(skillPromptPrefix([])).toBe("");
  });
});

type Body = Parameters<MessagesClient["beta"]["messages"]["stream"]>[0];
type Message = Awaited<
  ReturnType<ReturnType<MessagesClient["beta"]["messages"]["stream"]>["finalMessage"]>
>;
const msg = (over: Record<string, unknown>) =>
  ({
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  }) as unknown as Message;

describe("api runtime injects skills into user turns, not system prompts", () => {
  test("planner and executor", async () => {
    const calls: Body[] = [];
    const replies = [
      msg({
        content: [
          {
            type: "text",
            text: JSON.stringify({ steps: [{ id: "s1", title: "T", detail: "d" }] }),
          },
        ],
      }),
      msg({ content: [{ type: "text", text: "ok" }] }),
    ];
    const client: MessagesClient = {
      beta: {
        messages: {
          stream: (body) => {
            calls.push(structuredClone(body));
            return { finalMessage: async () => replies.shift() as Message };
          },
        },
      },
    };
    runScope(null).set({ status: "planning" });
    await runApiAgent("buat zzfoo page", {
      client,
      host: createToolHost(),
      signal: new AbortController().signal,
    });
    const [planner, executor] = calls;

    expect(planner?.system).toBe(PLANNER_SYSTEM);
    expect(JSON.stringify(executor?.system)).toContain(EXECUTOR_SYSTEM.slice(0, 40));
    for (const body of [planner, executor]) {
      expect(JSON.stringify(body?.system)).not.toContain("RULES-");
      const first = body?.messages[0]?.content as string;
      expect(first).toContain("RULES-fake-core");
      expect(first).toContain("RULES-fake-landing");
      expect(first).toContain("- CHECK-fake-landing");
    }
    expect(visible().log.some((e) => e.text === "Using skill: Fake landing")).toBe(true);
  });

  test("an explicit skillId overrides auto-detection", async () => {
    const calls: Body[] = [];
    const client: MessagesClient = {
      beta: {
        messages: {
          stream: (body) => {
            calls.push(structuredClone(body));
            return {
              finalMessage: async () =>
                msg({
                  content: [
                    { type: "text", text: JSON.stringify({ steps: [{ id: "s1", title: "T" }] }) },
                  ],
                  stop_reason: calls.length > 1 ? "refusal" : "end_turn",
                }),
            };
          },
        },
      },
    };
    runScope(null).set({ status: "planning" });
    await runApiAgent("buat zzfoo page", {
      client,
      host: createToolHost(),
      signal: new AbortController().signal,
      skillId: "fake-dash",
    });
    const first = calls[0]?.messages[0]?.content as string;
    expect(first).toContain("RULES-fake-dash");
    expect(first).not.toContain("RULES-fake-landing");
  });
});

describe("local agent prompt", () => {
  const info = (): LocalAgentInfo =>
    ({ id: "codex", name: "Codex", installed: true, supportsModels: false }) as LocalAgentInfo;

  test("prepends the skills line, keeps the user's text in the log", () => {
    state().set({
      bridge: { connected: true, claudeCodeAvailable: true, mcpUrl: "u", agents: [info()] },
      localAgentId: "codex",
    });
    const sent: EditorToBridge[] = [];
    startLocalAgentRun("r1", "buat zzfoo page", (m) => (sent.push(m), true));
    expect(sent[0]).toMatchObject({
      type: "run_start",
      prompt:
        "Use Pego skills: fake-core, fake-landing (call get_skill). Reply and write design copy in the language of the request below.\n\nbuat zzfoo page",
    });
    expect(visible().log.find((e) => e.kind === "user")?.text).toBe("buat zzfoo page");
    expect(visible().log.some((e) => e.text === "Using skill: Fake landing")).toBe(true);
  });

  test("explicit none leaves core only", () => {
    state().set({
      bridge: { connected: true, claudeCodeAvailable: true, mcpUrl: "u", agents: [info()] },
      localAgentId: "codex",
    });
    const sent: EditorToBridge[] = [];
    startLocalAgentRun("r2", "buat zzfoo page", (m) => (sent.push(m), true), null);
    expect((sent[0] as { prompt: string }).prompt.startsWith("Use Pego skills: fake-core (")).toBe(
      true,
    );
  });
});

describe("manual skill choice lasts one run", () => {
  test("startRun clears selectedSkillId", async () => {
    state().set({ backend: "local", bridge: emptyBridge() });
    state().setSelectedSkill("fake-dash");
    runScope(null).set({ status: "idle" });
    await startRun("buat zzfoo page");
    expect(state().selectedSkillId).toBeUndefined();
    expect(allRuns()).toEqual([]); // bridge is down: the run failed before starting
  });

  test("startRun clears selectedStyleId and hands it to the run", async () => {
    state().set({ backend: "local", bridge: emptyBridge() });
    state().setSelectedStyle("fakeswiss");
    runScope(null).set({ status: "idle" });
    await startRun("buat zzfoo page");
    expect(state().selectedStyleId).toBeUndefined();
    expect(visible().log.some((e) => e.text === "Using style: Fakeswiss")).toBe(true);
  });
});
