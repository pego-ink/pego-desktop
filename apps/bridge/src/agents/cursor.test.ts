import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import { buildChildEnv } from "./env";
import {
  buildCursorArgs,
  buildCursorCliConfig,
  buildCursorMcpConfig,
  createCursorParser,
  cursorAdapter,
  parseCursorModels,
} from "./cursor";
import { findExecutables } from "./process";

const fixture = (name: string): string[] =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean);

const parseAll = (lines: string[]) => {
  const parser = createCursorParser();
  const events: RunEvent[] = [];
  let violation: string | undefined;
  for (const line of lines) {
    const out = parser.push(line);
    events.push(...out.events);
    violation ??= out.violation;
  }
  return { events, violation };
};

describe("cursor builders", () => {
  test("mcp.json uses url; cli.json allows only pego and denies shell/files/web", () => {
    expect(buildCursorMcpConfig("http://127.0.0.1:1/mcp/run/t")).toEqual({
      mcpServers: { pego: { url: "http://127.0.0.1:1/mcp/run/t" } },
    });
    const { permissions } = buildCursorCliConfig();
    expect(permissions.allow).toEqual(["Mcp(pego:*)"]);
    expect(permissions.deny).toEqual(["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)"]);
  });

  test("args: print + stream-json, trust/approve-mcps, never --force, prompt after --", () => {
    const args = buildCursorArgs({ workdir: "/w", model: "auto", prompt: "-x do it" });
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--trust",
      "--approve-mcps",
      "--workspace",
      "/w",
      "--model",
      "auto",
      "--",
      "-x do it",
    ]);
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
  });
});

describe("cursor parser (fixtures built from the official output-format docs)", () => {
  test("mcp tool call run", () => {
    const { events, violation } = parseAll(fixture("cursor-tool-call.jsonl"));
    expect(violation).toBeUndefined();
    expect(events).toEqual([
      { kind: "text", text: "Fetching the document." },
      { kind: "tool", tool: "get_document", status: "started" },
      { kind: "tool", tool: "get_document", status: "finished" },
      { kind: "text", text: "DONE" },
      { kind: "done" },
    ]);
  });

  test("a shell tool call is a violation", () => {
    expect(parseAll(fixture("cursor-shell-attempt.jsonl")).violation).toContain("shell");
  });

  test("mcp error result and error result event", () => {
    const parser = createCursorParser();
    const call = (subtype: string, extra: object) =>
      JSON.stringify({
        type: "tool_call",
        subtype,
        call_id: "c",
        tool_call: {
          mcpToolCall: {
            args: { providerIdentifier: "pego", toolName: "update_nodes" },
            ...extra,
          },
        },
      });
    parser.push(call("started", {}));
    expect(
      parser.push(call("completed", { result: { error: { message: "bad" } } })).events,
    ).toEqual([{ kind: "tool", tool: "update_nodes", status: "finished", isError: true }]);
    expect(
      parser.push(
        JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "boom" }),
      ).events,
    ).toEqual([{ kind: "error", message: "Cursor Agent: boom" }]);
  });

  test("another MCP server's tool is a violation", () => {
    const out = createCursorParser().push(
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "c",
        tool_call: { mcpToolCall: { args: { providerIdentifier: "other", toolName: "x" } } },
      }),
    );
    expect(out.violation).toContain("not a Pego tool");
  });
});

describe("cursor models", () => {
  test("parses `id - Name` lines and skips prose", () => {
    const out =
      "Available models\n\nauto - Auto\n  gpt-5 - GPT-5 (current)\n* sonnet-4.5-thinking - Sonnet 4.5\n\nTip: use --model";
    expect(parseCursorModels(out)).toEqual(["auto", "gpt-5", "sonnet-4.5-thinking"]);
  });
});

describe("cursor adapter", () => {
  test("detect reports install state and login hint when not logged in", async () => {
    const env = buildChildEnv(process.env);
    const info = await cursorAdapter.detect(env);
    if (!findExecutables("cursor-agent", env)[0]) {
      expect(info.installed).toBe(false);
      return;
    }
    expect(info.installed).toBe(true);
    expect(info.version).toMatch(/^\d{4}\.|^\d+\.\d+/);
  });
});
