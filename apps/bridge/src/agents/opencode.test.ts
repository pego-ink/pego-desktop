import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import { buildChildEnv } from "./env";
import { makeFakeBin, shq } from "./fake-cli";
import {
  buildOpencodeArgs,
  buildOpencodeConfig,
  buildOpencodeEnv,
  OPENCODE_INSTRUCTIONS_FILE,
  opencodeAdapter,
  parseOpencodeModels,
} from "./opencode";
import { createOpencodeState, finishOpencodeRun, mapOpencodeLine } from "./opencode-events";
import type { AgentRunContext } from "./types";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);
const readLines = async (name: string) =>
  (await readFile(fixture(name), "utf8")).split("\n").filter((l) => l !== "");

describe("opencode config and command", () => {
  const config = buildOpencodeConfig({
    mcpUrl: "http://127.0.0.1:4519/mcp/run/TOKEN",
    instructionsPath: "/tmp/w/PEGO_INSTRUCTIONS.md",
  });

  test("registers Pego as the only remote MCP server, with the run-scoped url", () => {
    expect(config.mcp).toEqual({
      pego: { type: "remote", url: "http://127.0.0.1:4519/mcp/run/TOKEN", enabled: true },
    });
    expect(config.instructions).toEqual(["/tmp/w/PEGO_INSTRUCTIONS.md"]);
  });

  test("denies everything except opencode's code-mode runner and Pego's tools", () => {
    expect(config.permission).toEqual({ "*": "deny", execute: "allow", "pego_*": "allow" });
    // Order matters: the catch-all deny must come first so the allow rules override it.
    expect(Object.keys(config.permission as object)[0]).toBe("*");
    expect(JSON.stringify(config)).not.toContain('"bash":"allow"');
  });

  test("args: standalone private server, JSON output, model passes through unchanged", () => {
    expect(buildOpencodeArgs({ prompt: "x" })).toEqual(["run", "--standalone", "--format", "json"]);
    const model = "aki/cbai/deepseek-v4.1-flash(high)";
    expect(buildOpencodeArgs({ prompt: "x", model })).toEqual([
      "run",
      "--standalone",
      "--format",
      "json",
      "-m",
      model,
    ]);
    expect(buildOpencodeArgs({ prompt: "x", model: "deepseek/deepseek-flash#max" }).at(-1)).toBe(
      "deepseek/deepseek-flash#max",
    );
  });

  test("env: config via OPENCODE_CONFIG_CONTENT, provider keys restored, updates and project config off", () => {
    const base = buildChildEnv({ PATH: "/bin", OPENAI_API_KEY: "sk" }, "/h");
    expect(base.OPENAI_API_KEY).toBeUndefined();
    const env = buildOpencodeEnv(base, config, { OPENAI_API_KEY: "sk", DEEPSEEK_API_KEY: "ds" });
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? "")).toEqual(config);
    expect(env.OPENAI_API_KEY).toBe("sk");
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");
  });
});

describe("parseOpencodeModels", () => {
  test("keeps provider/model ids exactly, including parentheses and variants", () => {
    const out =
      "aki/cbai/deepseek-v4.1-flash(high)\nkn/deepseek-v4-1-flash\n\nopencode/big-pickle \nwarning: something odd\n";
    expect(parseOpencodeModels(out)).toEqual([
      "aki/cbai/deepseek-v4.1-flash(high)",
      "kn/deepseek-v4-1-flash",
      "opencode/big-pickle",
    ]);
  });
});

describe("mapOpencodeLine (recorded opencode 2.0.32 output)", () => {
  test("code-mode execute calls are reported as Pego tools; the failed first try is hidden", async () => {
    const state = createOpencodeState();
    const events: RunEvent[] = [];
    for (const line of await readLines("opencode-get-document.jsonl")) {
      events.push(...mapOpencodeLine(line, state));
    }
    expect(events.filter((e) => e.kind === "tool")).toEqual([
      { kind: "tool", tool: "get_document", status: "started" },
      { kind: "tool", tool: "get_document", status: "finished", isError: false },
    ]);
    expect(events.at(-1)).toMatchObject({ kind: "text" });
    expect(finishOpencodeRun(state)).toEqual([
      expect.objectContaining({ kind: "usage", inputTokens: expect.any(Number) }),
      { kind: "done" },
    ]);
    expect(state.inputTokens).toBeGreaterThan(0);
  });

  test("a provider error line becomes one error event", () => {
    const state = createOpencodeState();
    const line = JSON.stringify({
      type: "error",
      sessionID: "s",
      error: {
        type: "provider.auth",
        message: "OpenCode's free tier can only be used from within OpenCode.",
        status: 403,
      },
    });
    expect(mapOpencodeLine(line, state)).toEqual([
      { kind: "error", message: "OpenCode's free tier can only be used from within OpenCode." },
    ]);
    expect(mapOpencodeLine(line, state)).toEqual([]);
  });

  test("direct pego_* tools map too, non-pego internals and junk are ignored", () => {
    const state = createOpencodeState();
    const direct = (tool: string, status: string) =>
      JSON.stringify({ type: "tool_use", part: { tool, callID: "c", state: { status } } });
    expect(mapOpencodeLine(direct("pego_update_node", "error"), state)).toEqual([
      { kind: "tool", tool: "update_node", status: "started" },
      { kind: "tool", tool: "update_node", status: "finished", isError: true },
    ]);
    expect(mapOpencodeLine(direct("bash", "completed"), state)).toEqual([]);
    expect(mapOpencodeLine(direct("pego_get_node", "running"), state)).toEqual([]);
    expect(mapOpencodeLine("garbage", state)).toEqual([]);
  });
});

const fakeOpencode = async (body: { models?: string; run: string }) => {
  const record = await mkdtemp(join(tmpdir(), "pego-oc-rec-"));
  const bin = await makeFakeBin({
    opencode: `case "$1" in
  --version) echo "opencode v9.9.9";;
  models) printf '%s' ${shq(body.models ?? "a/b\nc/d(high)\n")};;
  run) printf '%s\\n' "$@" > ${shq(join(record, "args"))}; cat > ${shq(join(record, "stdin"))}; printf '%s' "$OPENCODE_CONFIG_CONTENT" > ${shq(join(record, "config"))}; cp "$PWD/${OPENCODE_INSTRUCTIONS_FILE}" ${shq(join(record, "instructions"))}; ${body.run};;
esac`,
  });
  return { bin, record, env: buildChildEnv({ PATH: `${bin}:/usr/bin:/bin` }) };
};

const makeCtx = async (env: Record<string, string>) => {
  const events: RunEvent[] = [];
  const ctx: AgentRunContext = {
    runId: "r",
    prompt: "Call get_document once, then reply DONE.",
    mcpUrl: "http://127.0.0.1:4519/mcp/run/TOKEN",
    systemPrompt: "SYSTEM PROMPT",
    workdir: await mkdtemp(join(tmpdir(), "pego-oc-work-")),
    env,
    signal: new AbortController().signal,
    emit: (event) => void events.push(event),
    model: "deepseek/deepseek-flash",
  };
  return { ctx, events };
};

describe("opencodeAdapter", () => {
  test("run: config via env, instructions file in the workdir, prompt on stdin, recorded stream", async () => {
    const { env, record } = await fakeOpencode({
      run: `cat ${shq(fixture("opencode-get-document.jsonl"))}`,
    });
    const { ctx, events } = await makeCtx(env);
    await opencodeAdapter.run(ctx);
    expect(events.map((e) => e.kind)).toEqual(["text", "tool", "tool", "text", "usage", "done"]);
    expect(await readFile(join(record, "stdin"), "utf8")).toBe(ctx.prompt);
    expect((await readFile(join(record, "args"), "utf8")).split("\n")).toEqual([
      "run",
      "--standalone",
      "--format",
      "json",
      "-m",
      "deepseek/deepseek-flash",
      "",
    ]);
    const config = JSON.parse(await readFile(join(record, "config"), "utf8"));
    expect(config.mcp.pego.url).toBe(ctx.mcpUrl);
    expect(config.permission["*"]).toBe("deny");
    expect(config.instructions).toEqual([join(ctx.workdir, OPENCODE_INSTRUCTIONS_FILE)]);
    const instructions = await readFile(join(record, "instructions"), "utf8");
    expect(instructions.startsWith("SYSTEM PROMPT")).toBe(true);
    expect(instructions).toContain("tools.pego");
  });

  test("run: a provider error line wins over the exit code", async () => {
    const line = JSON.stringify({ type: "error", error: { message: "Model not found: x/y" } });
    const { env } = await fakeOpencode({ run: `echo ${shq(line)}; exit 1` });
    const { ctx, events } = await makeCtx(env);
    await opencodeAdapter.run(ctx);
    expect(events).toEqual([{ kind: "error", message: "Model not found: x/y" }]);
  });

  test("run: a silent crash reports exit code and stderr tail", async () => {
    const { env } = await fakeOpencode({ run: "echo 'panic: bad config' >&2; exit 7" });
    const { ctx, events } = await makeCtx(env);
    await opencodeAdapter.run(ctx);
    expect((events[0] as { message: string }).message).toContain("exited with code 7");
    expect((events[0] as { message: string }).message).toContain("panic: bad config");
  });

  test("run: a clean exit without a fatal error ends with done even if the model stayed silent", async () => {
    const { env } = await fakeOpencode({ run: "true" });
    const { ctx, events } = await makeCtx(env);
    await opencodeAdapter.run(ctx);
    expect(events.at(-1)).toEqual({ kind: "done" });
  });

  test("detect and listModels use the CLI; ids come back untouched", async () => {
    const { env, bin } = await fakeOpencode({ run: "true" });
    expect(await opencodeAdapter.detect(env)).toEqual({
      installed: true,
      path: join(bin, "opencode"),
      version: "9.9.9",
    });
    expect(await opencodeAdapter.listModels?.(env)).toEqual(["a/b", "c/d(high)"]);
    const empty = await fakeOpencode({ models: "", run: "true" });
    expect(await opencodeAdapter.detect(empty.env)).toMatchObject({
      installed: true,
      note: expect.stringContaining("opencode auth login"),
    });
    expect(await opencodeAdapter.detect({ PATH: "/nonexistent" })).toMatchObject({
      installed: false,
    });
    await expect(
      opencodeAdapter.listModels?.({ PATH: "/nonexistent" }) ?? Promise.resolve([]),
    ).rejects.toThrow();
  });
});
