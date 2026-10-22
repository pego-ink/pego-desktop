import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import { CODEX_LOGIN_HINT, createCodexState, mapCodexLine } from "./codex-events";
import { buildCodexArgs, codexAdapter, parseCodexCatalog } from "./codex";
import { buildChildEnv } from "./env";
import { makeFakeBin, shq } from "./fake-cli";
import type { AgentRunContext } from "./types";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const readLines = async (name: string) =>
  (await readFile(fixture(name), "utf8")).split("\n").filter((l) => l !== "");

const mapAll = (lines: string[]): RunEvent[] => {
  const state = createCodexState();
  return lines.flatMap((line) => mapCodexLine(line, state));
};

const baseInput = {
  mcpUrl: "http://127.0.0.1:4519/mcp/run/TOKEN",
  systemPrompt: 'You edit "designs".\nBe brief.',
  workdir: "/tmp/pego-run-x",
};

describe("buildCodexArgs", () => {
  const args = buildCodexArgs(baseInput);
  const valueOf = (flag: string, prefix: string) =>
    args.filter((a, i) => args[i - 1] === flag && a.startsWith(prefix));

  test("runs headless with JSON output, the prompt on stdin and nothing persisted", () => {
    expect(args[0]).toBe("exec");
    expect(args.at(-1)).toBe("-");
    for (const flag of [
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
    ]) {
      expect(args).toContain(flag);
    }
    expect(args.slice(args.indexOf("-C"), args.indexOf("-C") + 2)).toEqual([
      "-C",
      baseInput.workdir,
    ]);
  });

  test("read-only sandbox, approvals off, no user profile, no bypass flags", () => {
    expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 2)).toEqual(["-s", "read-only"]);
    expect(valueOf("-c", "approval_policy=")).toEqual(['approval_policy="never"']);
    expect(valueOf("-c", "web_search=")).toEqual(['web_search="disabled"']);
    for (const bad of [
      "-p",
      "--profile",
      "--dangerously-bypass-approvals-and-sandbox",
      "danger-full-access",
      "-a",
    ]) {
      expect(args).not.toContain(bad);
    }
  });

  test("injects Pego's MCP server for this run only via -c overrides", () => {
    expect(valueOf("-c", "mcp_servers.pego.url=")).toEqual([
      'mcp_servers.pego.url="http://127.0.0.1:4519/mcp/run/TOKEN"',
    ]);
    expect(valueOf("-c", "mcp_servers.pego.default_tools_approval_mode=")).toEqual([
      'mcp_servers.pego.default_tools_approval_mode="approve"',
    ]);
    expect(args.join(" ")).not.toContain("mcp_servers.pego.command");
  });

  test("passes the system prompt as a TOML string (quotes and newlines escaped)", () => {
    const [override] = valueOf("-c", "developer_instructions=");
    expect(override).toBe(`developer_instructions=${JSON.stringify(baseInput.systemPrompt)}`);
    expect(override).not.toContain("\n");
  });

  test("turns shell and other side-effect features off", () => {
    const disabled = args.filter((a, i) => args[i - 1] === "--disable");
    for (const feature of ["shell_tool", "unified_exec", "apps", "plugins", "multi_agent"]) {
      expect(disabled).toContain(feature);
    }
  });

  test("model goes through -m unchanged, and is omitted when unset", () => {
    expect(args).not.toContain("-m");
    const withModel = buildCodexArgs({ ...baseInput, model: "gpt-5.6-sol" });
    expect(withModel.slice(withModel.indexOf("-m"), withModel.indexOf("-m") + 2)).toEqual([
      "-m",
      "gpt-5.6-sol",
    ]);
  });
});

describe("mapCodexLine (recorded codex 0.160.0 output)", () => {
  test("an MCP tool call, the final message and usage map to run events", async () => {
    expect(mapAll(await readLines("codex-get-document.jsonl"))).toEqual([
      { kind: "tool", tool: "get_document", status: "started" },
      { kind: "tool", tool: "get_document", status: "finished", isError: false },
      { kind: "text", text: "DONE" },
      { kind: "usage", inputTokens: 300, outputTokens: 60 },
      { kind: "done" },
    ]);
  });

  test("an expired login (reconnect noise then turn.failed) becomes a single login hint", async () => {
    expect(mapAll(await readLines("codex-auth-failure.jsonl"))).toEqual([
      { kind: "error", message: CODEX_LOGIN_HINT },
    ]);
  });

  test("failed MCP calls are flagged, completed-only calls still emit started first, junk is ignored", () => {
    const events = mapAll([
      "not json",
      "[]",
      '{"type":"item.completed","item":{"id":"a","type":"mcp_tool_call","server":"pego","tool":"update_node","status":"failed","error":{"message":"bad"}}}',
      '{"type":"item.completed","item":{"id":"b","type":"command_execution","command":"ls"}}',
      '{"type":"item.completed","item":{"id":"c","type":"error","message":"warn"}}',
    ]);
    expect(events).toEqual([
      { kind: "tool", tool: "update_node", status: "started" },
      { kind: "tool", tool: "update_node", status: "finished", isError: true },
    ]);
  });

  test("a non-auth turn.failed keeps its message", () => {
    expect(
      mapAll(['{"type":"turn.failed","error":{"message":"context window exceeded"}}']),
    ).toEqual([{ kind: "error", message: "context window exceeded" }]);
  });
});

describe("parseCodexCatalog", () => {
  test("lists only visible models by slug", () => {
    expect(
      parseCodexCatalog(
        JSON.stringify({
          models: [
            { slug: "gpt-5.5", visibility: "list" },
            { slug: "codex-auto-review", visibility: "hide" },
            { slug: "gpt-6-sol", visibility: "list" },
            { visibility: "list" },
          ],
        }),
      ),
    ).toEqual(["gpt-5.5", "gpt-6-sol"]);
    expect(() => parseCodexCatalog("nope")).toThrow();
  });
});

const fakeCodex = async (opts: { loggedIn?: boolean; execBody: string; catalog?: string }) => {
  const record = await mkdtemp(join(tmpdir(), "pego-codex-rec-"));
  const bin = await makeFakeBin({
    codex: `case "$1" in
  --version) echo "codex-cli 9.9.9";;
  login) ${opts.loggedIn === false ? "echo 'Not logged in' >&2; exit 1" : "echo 'Logged in using ChatGPT'"};;
  debug) echo ${shq(opts.catalog ?? '{"models":[{"slug":"gpt-5.5","visibility":"list"}]}')};;
  exec) printf '%s\\n' "$@" > ${shq(join(record, "args"))}; cat > ${shq(join(record, "stdin"))}; ${opts.execBody};;
esac`,
  });
  return { bin, record, env: buildChildEnv({ PATH: `${bin}:/usr/bin:/bin` }) };
};

const makeCtx = (env: Record<string, string>, overrides: Partial<AgentRunContext> = {}) => {
  const events: RunEvent[] = [];
  const ctx: AgentRunContext = {
    runId: "r",
    prompt: "Call get_document once, then reply DONE.",
    ...baseInput,
    workdir: tmpdir(),
    env,
    signal: new AbortController().signal,
    emit: (event) => void events.push(event),
    ...overrides,
  };
  return { ctx, events };
};

describe("codexAdapter", () => {
  test("run: feeds the prompt on stdin, streams the recorded events and ends with done", async () => {
    const { env, record } = await fakeCodex({
      execBody: `cat ${shq(fixture("codex-get-document.jsonl"))}`,
    });
    const { ctx, events } = makeCtx(env, { model: "gpt-5.5" });
    await codexAdapter.run(ctx);
    expect(events.map((e) => e.kind)).toEqual(["tool", "tool", "text", "usage", "done"]);
    expect(await readFile(join(record, "stdin"), "utf8")).toBe(ctx.prompt);
    const args = (await readFile(join(record, "args"), "utf8")).split("\n");
    expect(args).toContain('mcp_servers.pego.url="http://127.0.0.1:4519/mcp/run/TOKEN"');
    expect(args).toContain("gpt-5.5");
  });

  test("run: a non-zero exit without a turn event reports the last stderr lines", async () => {
    const { env } = await fakeCodex({ execBody: "echo 'config exploded' >&2; exit 2" });
    const { ctx, events } = makeCtx(env);
    await codexAdapter.run(ctx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error" });
    expect((events[0] as { message: string }).message).toContain("exited with code 2");
    expect((events[0] as { message: string }).message).toContain("config exploded");
  });

  test("run: an expired login is reported as a login hint", async () => {
    const { env } = await fakeCodex({
      execBody: `cat ${shq(fixture("codex-auth-failure.jsonl"))}; exit 1`,
    });
    const { ctx, events } = makeCtx(env);
    await codexAdapter.run(ctx);
    expect(events).toEqual([{ kind: "error", message: CODEX_LOGIN_HINT }]);
  });

  test("run: without a codex binary it says so", async () => {
    const { ctx, events } = makeCtx({ PATH: "/nonexistent" });
    await codexAdapter.run(ctx);
    expect(events).toEqual([{ kind: "error", message: "Codex CLI was not found on PATH." }]);
  });

  test("detect: installed and logged in, installed but logged out, missing", async () => {
    const ok = await fakeCodex({ execBody: "true" });
    expect(await codexAdapter.detect(ok.env)).toEqual({
      installed: true,
      path: join(ok.bin, "codex"),
      version: "9.9.9",
    });
    const out = await fakeCodex({ loggedIn: false, execBody: "true" });
    expect(await codexAdapter.detect(out.env)).toMatchObject({
      installed: true,
      note: "Not logged in. Run `codex login` once.",
    });
    expect(await codexAdapter.detect({ PATH: "/nonexistent" })).toMatchObject({ installed: false });
  });

  test("listModels: bundled catalog, with a curated fallback", async () => {
    const ok = await fakeCodex({
      execBody: "true",
      catalog:
        '{"models":[{"slug":"gpt-6-sol","visibility":"list"},{"slug":"x","visibility":"hide"}]}',
    });
    expect(await codexAdapter.listModels?.(ok.env)).toEqual(["gpt-6-sol"]);
    const broken = await fakeCodex({ execBody: "true", catalog: "garbage" });
    expect(await codexAdapter.listModels?.(broken.env)).toEqual(["gpt-5.5"]);
    expect(await codexAdapter.listModels?.({ PATH: "/nonexistent" })).toEqual(["gpt-5.5"]);
  });
});
