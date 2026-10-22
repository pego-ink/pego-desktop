import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import { buildChildEnv } from "./env";
import { startFakeGemini } from "./fixtures/fake-gemini";
import { startTestMcpServer } from "./fixtures/test-mcp-server";
import {
  buildGeminiArgs,
  buildGeminiSettings,
  createGeminiParser,
  GEMINI_EXCLUDED_TOOLS,
  geminiAdapter,
} from "./gemini";
import { findExecutables } from "./process";
import { checksumGlobalConfigs, makeTempDir, runAdapter, writeSettings } from "./smoke-helpers";

const fixture = (name: string): string[] =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean);

const parseAll = (lines: string[]) => {
  const parser = createGeminiParser();
  const events: RunEvent[] = [];
  let violation: string | undefined;
  for (const line of lines) {
    const out = parser.push(line);
    events.push(...out.events);
    violation ??= out.violation;
  }
  return { events, violation };
};

describe("gemini builders", () => {
  test("settings: httpUrl + trust for pego only, built-in tools excluded", () => {
    const settings = buildGeminiSettings("http://127.0.0.1:9/mcp/run/t");
    expect(settings.mcpServers).toEqual({
      pego: { httpUrl: "http://127.0.0.1:9/mcp/run/t", trust: true },
    });
    expect(settings.mcp).toEqual({ allowed: ["pego"] });
    for (const tool of ["run_shell_command", "write_file", "replace", "save_memory", "read_file"]) {
      expect(settings.tools.exclude).toContain(tool);
    }
    expect(GEMINI_EXCLUDED_TOOLS.length).toBeGreaterThan(25);
  });

  test("args: stream-json, prompt as --prompt=value so a leading dash is safe", () => {
    const args = buildGeminiArgs({ model: "gemini-2.5-flash", prompt: "--rm -rf" });
    expect(args).toContain("--prompt=--rm -rf");
    expect(args.slice(args.indexOf("-o"), args.indexOf("-o") + 2)).toEqual(["-o", "stream-json"]);
    expect(args).toContain("--skip-trust");
    expect(args[args.indexOf("--allowed-mcp-server-names") + 1]).toBe("pego");
    expect(args[args.indexOf("-m") + 1]).toBe("gemini-2.5-flash");
    expect(buildGeminiArgs({ prompt: "x" })).not.toContain("-m");
  });
});

describe("gemini parser (recorded fixtures)", () => {
  test("tool call run", () => {
    const { events, violation } = parseAll(fixture("gemini-tool-call.jsonl"));
    expect(violation).toBeUndefined();
    expect(events).toEqual([
      { kind: "tool", tool: "get_document", status: "started" },
      { kind: "tool", tool: "get_document", status: "finished" },
      { kind: "text", text: "DONE" },
      { kind: "usage", inputTokens: 20, outputTokens: 6 },
      { kind: "done" },
    ]);
  });

  test("api error result", () => {
    const { events } = parseAll(fixture("gemini-api-error.jsonl"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error" });
    expect((events[0] as { message: string }).message).toContain("API key not valid");
  });

  test("failed tool result sets isError; non-pego tool is a violation", () => {
    const parser = createGeminiParser();
    parser.push(
      JSON.stringify({ type: "tool_use", tool_name: "mcp_pego_get_document", tool_id: "t1" }),
    );
    expect(
      parser.push(JSON.stringify({ type: "tool_result", tool_id: "t1", status: "error" })).events,
    ).toEqual([{ kind: "tool", tool: "get_document", status: "finished", isError: true }]);
    expect(
      createGeminiParser().push(
        JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", tool_id: "t2" }),
      ).violation,
    ).toContain("run_shell_command");
  });

  test("warnings, init and banners are ignored", () => {
    const parser = createGeminiParser();
    expect(parser.push("YOLO mode is enabled.").events).toEqual([]);
    expect(
      parser.push(JSON.stringify({ type: "error", severity: "warning", message: "x" })).events,
    ).toEqual([]);
    expect(parser.push(JSON.stringify({ type: "init", model: "m" })).events).toEqual([]);
  });
});

const geminiPath = findExecutables("gemini", buildChildEnv(process.env))[0];

describe("gemini adapter", () => {
  test("detect finds the installed CLI", async () => {
    if (!geminiPath) return;
    const info = await geminiAdapter.detect(buildChildEnv(process.env));
    expect(info.installed).toBe(true);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("listModels is curated", async () => {
    expect((await geminiAdapter.listModels?.({}))?.length).toBeGreaterThan(0);
  });

  test("smoke: real gemini calls get_document over MCP then finishes", async () => {
    if (!geminiPath) return;
    const before = await checksumGlobalConfigs();
    const llm = startFakeGemini();
    const mcp = startTestMcpServer();
    const home = await makeTempDir("gemini-home");
    try {
      // GEMINI_CLI_HOME isolates auth from the user's real login; the fake server is the "API".
      await writeSettings(join(home, ".gemini", "settings.json"), {
        security: { auth: { selectedType: "gemini-api-key" } },
      });
      const { events } = await runAdapter(geminiAdapter, {
        mcpUrl: mcp.url,
        prompt: "Call get_document once, then reply DONE.",
        model: "gemini-2.5-flash",
        env: {
          GEMINI_CLI_HOME: home,
          GEMINI_API_KEY: "fake",
          GOOGLE_GEMINI_BASE_URL: llm.baseUrl,
        },
      });
      expect(mcp.calls).toEqual(["get_document"]);
      expect(events.map((e) => e.kind)).toEqual(["tool", "tool", "text", "usage", "done"]);
      expect(JSON.stringify(llm.requests[0])).toContain("You are a design agent.");
      const main = llm.toolNameLists[0] ?? [];
      expect(main).toContain("mcp_pego_get_document");
      // nothing that can run commands or touch files is offered
      for (const forbidden of ["run_shell_command", "write_file", "replace", "read_file"]) {
        expect(main).not.toContain(forbidden);
      }
    } finally {
      llm.stop();
      mcp.stop();
    }
    expect(await checksumGlobalConfigs()).toEqual(before);
  }, 60_000);
});
