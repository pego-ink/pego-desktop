import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import { startFakeOpenAi } from "./fixtures/fake-openai";
import { startTestMcpServer } from "./fixtures/test-mcp-server";
import { findExecutables } from "./process";
import { buildChildEnv } from "./env";
import {
  buildQwenArgs,
  buildQwenMcpConfig,
  createQwenParser,
  qwenAdapter,
  QWEN_EXCLUDED_TOOLS,
} from "./qwen";
import { checksumGlobalConfigs, makeTempDir, runAdapter, writeSettings } from "./smoke-helpers";

const fixture = (name: string): string[] =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean);

const parseAll = (lines: string[]) => {
  const parser = createQwenParser();
  const events: RunEvent[] = [];
  let violation: string | undefined;
  for (const line of lines) {
    const out = parser.push(line);
    events.push(...out.events);
    violation ??= out.violation;
  }
  return { events, violation };
};

describe("qwen builders", () => {
  test("mcp config uses httpUrl, trust and alwaysLoadTools", () => {
    expect(buildQwenMcpConfig("http://127.0.0.1:1/mcp/run/t")).toEqual({
      mcpServers: {
        pego: { httpUrl: "http://127.0.0.1:1/mcp/run/t", trust: true, alwaysLoadTools: true },
      },
    });
  });

  test("args: safe mode, stream-json, only the pego server, shell/file tools excluded", () => {
    const args = buildQwenArgs({
      mcpConfigPath: "/w/pego-mcp.json",
      model: "m1",
      systemPrompt: " SYS ",
    });
    expect(args).toContain("--safe-mode");
    expect(args.slice(args.indexOf("-o"), args.indexOf("-o") + 2)).toEqual(["-o", "stream-json"]);
    expect(args).toContain("--append-system-prompt=SYS");
    expect(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2)).toEqual(["-m", "m1"]);
    expect(args[args.indexOf("--allowed-mcp-server-names") + 1]).toBe("pego");
    // array options last, so nothing positional can be swallowed
    expect(args.indexOf("--exclude-tools")).toBeGreaterThan(
      args.indexOf("--allowed-mcp-server-names"),
    );
    for (const tool of ["run_shell_command", "write_file", "edit", "manage_memory", "agent"]) {
      expect(QWEN_EXCLUDED_TOOLS).toContain(tool);
    }
  });

  test("model and empty system prompt are optional", () => {
    const args = buildQwenArgs({ mcpConfigPath: "/w/x.json", systemPrompt: "  " });
    expect(args).not.toContain("-m");
    expect(args.some((a) => a.startsWith("--append-system-prompt"))).toBe(false);
  });
});

describe("qwen parser (recorded fixtures)", () => {
  test("tool call run maps to started/finished/text/usage/done", () => {
    const { events, violation } = parseAll(fixture("qwen-tool-call.jsonl"));
    expect(violation).toBeUndefined();
    expect(events).toEqual([
      { kind: "tool", tool: "get_document", status: "started" },
      { kind: "tool", tool: "get_document", status: "finished" },
      { kind: "text", text: "DONE" },
      { kind: "usage", inputTokens: 20, outputTokens: 6 },
      { kind: "done" },
    ]);
  });

  test("provider error becomes one error event (no duplicate text)", () => {
    const { events } = parseAll(fixture("qwen-api-error.jsonl"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error" });
    expect((events[0] as { message: string }).message).toContain("404");
  });

  test("tool_result with is_error maps to isError", () => {
    const parser = createQwenParser();
    parser.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "a", name: "mcp__pego__update_nodes", input: {} }],
        },
      }),
    );
    const out = parser.push(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "a", is_error: true, content: "x" }],
        },
      }),
    );
    expect(out.events).toEqual([
      { kind: "tool", tool: "update_nodes", status: "finished", isError: true },
    ]);
  });

  test("a non-pego tool use or a shell tool in init is a violation", () => {
    const shell = createQwenParser().push(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "a", name: "run_shell_command", input: {} }] },
      }),
    );
    expect(shell.violation).toContain("run_shell_command");
    const init = createQwenParser().push(
      JSON.stringify({ type: "system", subtype: "init", tools: ["mcp__pego__x", "write_file"] }),
    );
    expect(init.violation).toContain("write_file");
  });

  test("non-JSON noise and sub-agent traffic are ignored", () => {
    const parser = createQwenParser();
    expect(parser.push("Warning: something").events).toEqual([]);
    expect(
      parser.push(
        JSON.stringify({
          type: "assistant",
          parent_tool_use_id: "p",
          message: { content: [{ type: "text", text: "hidden" }] },
        }),
      ).events,
    ).toEqual([]);
  });
});

const qwenPath = findExecutables("qwen", buildChildEnv(process.env))[0];

describe("qwen adapter", () => {
  test("detect finds the installed CLI", async () => {
    if (!qwenPath) return;
    const info = await qwenAdapter.detect(buildChildEnv(process.env));
    expect(info.installed).toBe(true);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("listModels returns a non-empty curated list", async () => {
    const models = await qwenAdapter.listModels?.(buildChildEnv(process.env));
    expect(models?.length).toBeGreaterThan(0);
  });

  test("smoke: real qwen calls get_document over MCP then finishes", async () => {
    if (!qwenPath) return;
    const before = await checksumGlobalConfigs();
    const llm = startFakeOpenAi();
    const mcp = startTestMcpServer();
    const home = await makeTempDir("qwen-home");
    try {
      // QWEN_HOME isolates auth/model from the user's real login; the fake server stands in for the LLM.
      await writeSettings(join(home, "settings.json"), {
        security: { auth: { selectedType: "openai", apiKey: "fake", baseUrl: llm.baseUrl } },
        model: { name: "fake" },
      });
      const { events } = await runAdapter(qwenAdapter, {
        mcpUrl: mcp.url,
        prompt: "Call get_document once, then reply DONE.",
        env: { QWEN_HOME: home, OPENAI_BASE_URL: llm.baseUrl, OPENAI_API_KEY: "fake" },
      });
      expect(mcp.calls).toEqual(["get_document"]);
      expect(events.map((e) => e.kind)).toEqual(["tool", "tool", "text", "usage", "done"]);
      const first = llm.requests[0] as { messages: { content: string }[] };
      expect(first.messages[0]?.content).toContain("You are a design agent.");
      // every model request offered only the pego tool
      for (const request of llm.requests as { tools?: { function: { name: string } }[] }[]) {
        const names = (request.tools ?? []).map((t) => t.function.name);
        expect(names.every((n) => n === "mcp__pego__get_document")).toBe(true);
      }
    } finally {
      llm.stop();
      mcp.stop();
    }
    expect(await checksumGlobalConfigs()).toEqual(before);
  }, 60_000);
});
