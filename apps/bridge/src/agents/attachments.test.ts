import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import { attachmentPromptNote, writeAttachments } from "../attachments";
import { buildUserMessage, createClaudeCodeAdapter } from "./claude-code";
import { buildCodexArgs, codexAdapter } from "./codex";
import {
  buildCursorCliConfig,
  createCursorParser,
  cursorAdapter,
  cursorAttachmentNote,
  isAttachmentRead,
} from "./cursor";
import { buildChildEnv } from "./env";
import { makeFakeBin, shq } from "./fake-cli";
import { makeAttachment } from "./fixtures/images";
import { buildGeminiArgs, geminiAdapter } from "./gemini";
import { buildOpencodeArgs, opencodeAdapter } from "./opencode";
import { qwenAdapter } from "./qwen";
import type { AgentAdapter, AgentRunContext } from "./types";

const dirs: string[] = [];
const tmp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), `pego-${prefix}-`));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A context whose workdir already holds two written attachments, as the run manager does it. */
const makeCtx = async (env: Record<string, string> = {}) => {
  const workdir = await tmp("att-work");
  const raw = [makeAttachment("att-1", "image/png"), makeAttachment("att-2", "image/jpeg")];
  const attachments = await writeAttachments(workdir, raw);
  const events: RunEvent[] = [];
  const ctx: AgentRunContext = {
    runId: "r",
    prompt: `What is this?${attachmentPromptNote(attachments)}`,
    mcpUrl: "http://127.0.0.1:1/mcp/run/TOKEN",
    systemPrompt: "SYS",
    workdir,
    env,
    attachments,
    signal: new AbortController().signal,
    emit: (event) => void events.push(event),
  };
  return { ctx, events, attachments };
};

/** Fake CLI that records its arguments, stdin and `.cursor/cli.json`, then exits 0. */
const recordingBin = async (name: string, extra = "") => {
  const record = await tmp("att-rec");
  const bin = await makeFakeBin({
    [name]: `case "$1" in --version) echo "9.9.9"; exit 0;; esac
printf '%s\\n' "$@" > ${shq(join(record, "args"))}
cat > ${shq(join(record, "stdin"))}
${extra}
exit 0`,
  });
  return { record, env: buildChildEnv({ PATH: `${bin}:/usr/bin:/bin` }) };
};
const lines = async (path: string) => (await readFile(path, "utf8")).split("\n");

const run = (adapter: AgentAdapter, ctx: AgentRunContext) => adapter.run(ctx);

describe("claude code (Agent SDK streaming input)", () => {
  test("no attachments: the message content is the plain text", () => {
    expect(buildUserMessage("hi").message.content).toBe("hi");
  });

  test("attachments: one user message, image blocks (base64) first, text last", async () => {
    const a = makeAttachment("att-1", "image/png");
    const b = makeAttachment("att-2", "image/webp");
    const messages = [buildUserMessage("describe", [a, b])];
    expect(messages).toEqual([
      {
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: a.data } },
            { type: "image", source: { type: "base64", media_type: "image/webp", data: b.data } },
            { type: "text", text: "describe" },
          ],
        },
      },
    ]);
  });

  test("run: the adapter hands query() the streaming prompt, not the string", async () => {
    let seen: unknown;
    const adapter = createClaudeCodeAdapter({
      runQuery: ((params: { prompt: unknown }) => {
        seen = params.prompt;
        return (async function* () {
          yield { type: "result", subtype: "success", is_error: false, result: "ok", usage: {} };
        })();
      }) as never,
    });
    const { ctx, events } = await makeCtx();
    await run(adapter, {
      ...ctx,
      createMcpServer: () => ({}) as never,
    });
    expect(typeof seen).not.toBe("string");
    const iterable = seen as AsyncIterable<{ message: { content: { type: string }[] } }>;
    const first = await iterable[Symbol.asyncIterator]().next();
    expect(first.value.message.content.map((block: { type: string }) => block.type)).toEqual([
      "image",
      "image",
      "text",
    ]);
    expect(events.at(-1)?.kind).toBe("done");
  });
});

describe("codex (-i/--image)", () => {
  const base = { mcpUrl: "http://127.0.0.1:1/m", systemPrompt: "S", workdir: "/w" };
  const attachments = [
    {
      ...makeAttachment("att-1"),
      path: "/w/attachments/att-1.png",
      relativePath: "attachments/att-1.png",
    },
    {
      ...makeAttachment("att-2", "image/jpeg"),
      path: "/w/attachments/att-2.jpg",
      relativePath: "attachments/att-2.jpg",
    },
  ];

  test("one -i per file, each followed by another option; the stdin marker stays last", () => {
    const args = buildCodexArgs({ ...base, attachments });
    const at = args.indexOf("-i");
    expect(args.slice(at, at + 5)).toEqual([
      "-i",
      "/w/attachments/att-1.png",
      "-i",
      "/w/attachments/att-2.jpg",
      "-s",
    ]);
    expect(args.at(-1)).toBe("-");
    expect(args.filter((arg) => arg === "-i")).toHaveLength(2);
  });

  test("no attachments: no -i", () => {
    expect(buildCodexArgs(base)).not.toContain("-i");
  });

  test("run: the CLI gets the image paths and the prompt on stdin", async () => {
    const { record, env } = await recordingBin("codex");
    const { ctx, attachments: written } = await makeCtx(env);
    await run(codexAdapter, ctx);
    const args = await lines(join(record, "args"));
    for (const item of written) expect(args[args.indexOf(item.path) - 1]).toBe("-i");
    expect(await readFile(join(record, "stdin"), "utf8")).toBe(ctx.prompt);
  });
});

describe("opencode (-f/--file)", () => {
  test("one -f per file after the model flag", () => {
    const attachments = [
      {
        ...makeAttachment("att-1"),
        path: "/w/attachments/att-1.png",
        relativePath: "attachments/att-1.png",
      },
      {
        ...makeAttachment("att-2", "image/gif"),
        path: "/w/attachments/att-2.gif",
        relativePath: "attachments/att-2.gif",
      },
    ];
    expect(buildOpencodeArgs({ prompt: "x", model: "a/b", attachments })).toEqual([
      "run",
      "--standalone",
      "--format",
      "json",
      "-m",
      "a/b",
      "-f",
      "/w/attachments/att-1.png",
      "-f",
      "/w/attachments/att-2.gif",
    ]);
    expect(buildOpencodeArgs({ prompt: "x" })).not.toContain("-f");
  });

  test("run: the CLI gets the files and the prompt on stdin", async () => {
    const { record, env } = await recordingBin("opencode");
    const { ctx, attachments } = await makeCtx(env);
    await run(opencodeAdapter, ctx);
    const args = await lines(join(record, "args"));
    for (const item of attachments) expect(args[args.indexOf(item.path) - 1]).toBe("-f");
    expect(await readFile(join(record, "stdin"), "utf8")).toBe(ctx.prompt);
  });
});

describe("gemini (@file)", () => {
  const attachments = [
    {
      ...makeAttachment("att-1"),
      path: "/w/attachments/att-1.png",
      relativePath: "attachments/att-1.png",
    },
  ];

  test("the prompt ends with @attachments/<id>.<ext> references", () => {
    const args = buildGeminiArgs({ prompt: "look", attachments });
    expect(args).toContain("--prompt=look\n\n@attachments/att-1.png");
    expect(buildGeminiArgs({ prompt: "look" })).toContain("--prompt=look");
  });

  test("run: references reach the CLI, built-in file tools stay excluded", async () => {
    const { record, env } = await recordingBin("gemini");
    const { ctx } = await makeCtx(env);
    await run(geminiAdapter, ctx);
    const args = await lines(join(record, "args"));
    expect(args.some((arg) => arg.includes("@attachments/att-1.png @attachments/att-2.jpg"))).toBe(
      true,
    );
    const settings = JSON.parse(
      await readFile(join(ctx.workdir, ".gemini", "settings.json"), "utf8"),
    );
    for (const tool of ["read_file", "read_many_files", "run_shell_command", "write_file"]) {
      expect(settings.tools.exclude).toContain(tool);
    }
  });
});

describe("qwen (@file)", () => {
  test("run: references are appended to the stdin prompt, read tools stay excluded", async () => {
    const { record, env } = await recordingBin("qwen");
    const { ctx } = await makeCtx(env);
    await run(qwenAdapter, ctx);
    expect(await readFile(join(record, "stdin"), "utf8")).toBe(
      `${ctx.prompt}\n\n@attachments/att-1.png @attachments/att-2.jpg`,
    );
    const args = await lines(join(record, "args"));
    const excluded = args.slice(args.indexOf("--exclude-tools") + 1);
    for (const tool of ["read_file", "run_shell_command", "write_file", "glob", "grep_search"]) {
      expect(excluded).toContain(tool);
    }
  });
});

describe("cursor agent (paths + narrowly allowed read)", () => {
  const workdir = "/tmp/pego-run-abc";
  const read = (path: string) => ({ readToolCall: { args: { path } } });

  test("cli.json: without attachments reads stay denied; with them only attachments/** is allowed", () => {
    expect(buildCursorCliConfig().permissions.deny).toContain("Read(**)");
    expect(buildCursorCliConfig().permissions.allow).toEqual(["Mcp(pego:*)"]);
    const { permissions } = buildCursorCliConfig({ attachments: true });
    expect(permissions.allow).toEqual(["Mcp(pego:*)", "Read(attachments/**)"]);
    expect(permissions.deny).toEqual(["Shell(*)", "Write(**)", "WebFetch(*)"]);
  });

  test("isAttachmentRead accepts only att-<n>.<ext> directly inside attachments/", () => {
    for (const path of ["attachments/att-1.png", `${workdir}/attachments/att-2.jpg`]) {
      expect(isAttachmentRead(read(path), workdir)).toBe(true);
    }
    for (const path of [
      "",
      ".cursor/mcp.json",
      "attachments/../.cursor/mcp.json",
      "attachments/att-1.png/../../x",
      "attachments/sub/att-1.png",
      "attachments/att-1.svg",
      "attachments/evil.png",
      "/etc/passwd",
      `${workdir}-other/attachments/att-1.png`,
    ]) {
      expect(isAttachmentRead(read(path), workdir)).toBe(false);
    }
    expect(
      isAttachmentRead({ shellToolCall: { args: { path: "attachments/att-1.png" } } }, workdir),
    ).toBe(false);
  });

  test("parser: an attachment read is allowed, any other read still stops the run", () => {
    const line = (path: string) =>
      JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "c1",
        tool_call: read(path),
      });
    const parser = createCursorParser({ workdir });
    expect(parser.push(line("attachments/att-1.png"))).toEqual({ events: [] });
    expect(parser.push(line("/etc/passwd")).violation).toContain("not a Pego tool");
    // without a workdir (no attachments) every read is a violation
    expect(createCursorParser().push(line("attachments/att-1.png")).violation).toBeDefined();
  });

  test("run: the prompt lists the file paths and cli.json allows the read", async () => {
    const { record, env } = await recordingBin("cursor-agent");
    const { ctx, attachments } = await makeCtx(env);
    await run(cursorAdapter, ctx);
    const args = await lines(join(record, "args"));
    const prompt = args.join("\n");
    expect(prompt).toContain("attachments/att-1.png, attachments/att-2.jpg");
    expect(prompt).toContain('place_image with src "attachment:<id>"');
    expect(cursorAttachmentNote(attachments)).toContain("read tool");
    const cli = JSON.parse(await readFile(join(ctx.workdir, ".cursor", "cli.json"), "utf8"));
    expect(cli.permissions.allow).toContain("Read(attachments/**)");
  });
});
