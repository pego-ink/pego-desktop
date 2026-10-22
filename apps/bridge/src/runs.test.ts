import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CONCURRENT_RUNS, type RunEvent } from "@pego/agent";
import { isAlive, makeFakeBin, waitFor } from "./agents/fake-cli";
import { runCli } from "./agents/process";
import type { AgentAdapter, AgentRunContext } from "./agents/types";
import { makeAttachment } from "./agents/fixtures/images";
import { createRunManager, parseRunMcpPath, type RunManagerDeps } from "./runs";

const roots: string[] = [];
const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "pego-runs-test-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const adapterOf = (run: AgentAdapter["run"], id: AgentAdapter["id"] = "codex"): AgentAdapter => ({
  id,
  name: id,
  supportsModels: false,
  detect: async () => ({ installed: true }),
  run,
});

const setup = async (
  adapter: AgentAdapter,
  overrides: Partial<RunManagerDeps> = {},
): Promise<{
  runs: ReturnType<typeof createRunManager>;
  events: Array<[string, RunEvent]>;
  root: string;
}> => {
  const root = await makeRoot();
  const events: Array<[string, RunEvent]> = [];
  const runs = createRunManager({
    callTool: async () => ({ content: "", isError: false }),
    emit: (runId, event) => void events.push([runId, event]),
    mcpOrigin: () => "http://127.0.0.1:4519",
    adapters: [adapter],
    tmpRoot: root,
    ...overrides,
  });
  return { runs, events, root };
};

const finished = async (runs: { isRunning: () => boolean }) => {
  while (runs.isRunning()) await Bun.sleep(5);
};
const start = (
  runs: ReturnType<typeof createRunManager>,
  runId = "r1",
  extra: { model?: string } = {},
) => runs.start({ runId, prompt: "go", agentId: "codex", ...extra });

describe("createRunManager", () => {
  test("hands the adapter a scoped context and ends with the adapter's done", async () => {
    let seen: AgentRunContext | undefined;
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        seen = ctx;
        ctx.emit({ kind: "text", text: "hi" });
        ctx.emit({ kind: "done" });
      }),
    );
    start(runs, "r1", { model: "provider/model(high)" });
    await finished(runs);
    expect(events.map(([, e]) => e.kind)).toEqual(["text", "done"]);
    expect(seen?.runId).toBe("r1");
    expect(seen?.prompt).toBe("go");
    expect(seen?.model).toBe("provider/model(high)");
    expect(seen?.mcpUrl).toMatch(/^http:\/\/127\.0\.0\.1:4519\/mcp\/run\/[A-Za-z0-9_-]{43}$/);
    expect(seen?.systemPrompt.length).toBeGreaterThan(10);
  });

  test("attachments are written to the workdir before the adapter starts, noted in the prompt and removed with the workdir", async () => {
    let seen: AgentRunContext | undefined;
    let onDisk: string[] = [];
    let bytes: Buffer | undefined;
    const { runs, events, root } = await setup(
      adapterOf(async (ctx) => {
        seen = ctx;
        onDisk = (await readdir(join(ctx.workdir, "attachments"))).sort();
        bytes = await readFile(ctx.attachments?.[0]?.path ?? "");
        ctx.emit({ kind: "done" });
      }),
    );
    const first = makeAttachment("att-1", "image/png", { name: "../../evil.png" });
    runs.start({
      runId: "r1",
      prompt: "go",
      agentId: "codex",
      attachments: [first, makeAttachment("att-2", "image/webp")],
    });
    await finished(runs);
    expect(events.map(([, e]) => e.kind)).toEqual(["done"]);
    expect(onDisk).toEqual(["att-1.png", "att-2.webp"]);
    expect(bytes).toEqual(Buffer.from(first.data, "base64"));
    expect(seen?.attachments?.map((item) => item.relativePath)).toEqual([
      "attachments/att-1.png",
      "attachments/att-2.webp",
    ]);
    expect(seen?.prompt.startsWith("go")).toBe(true);
    expect(seen?.prompt).toContain("att-1 (");
    expect(seen?.prompt).toContain("att-2 (");
    expect(seen?.prompt).toContain('src "attachment:<id>"');
    expect(existsSync(seen?.workdir ?? "")).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  test("no attachments: prompt untouched and ctx.attachments absent", async () => {
    let seen: AgentRunContext | undefined;
    const { runs } = await setup(
      adapterOf(async (ctx) => {
        seen = ctx;
        ctx.emit({ kind: "done" });
      }),
    );
    start(runs);
    await finished(runs);
    expect(seen?.prompt).toBe("go");
    expect(seen && "attachments" in seen).toBe(false);
  });

  test("an unsafe attachment id fails the run without starting the adapter and still cleans up", async () => {
    let started = false;
    const { runs, events, root } = await setup(
      adapterOf(async () => {
        started = true;
      }),
    );
    runs.start({
      runId: "r1",
      prompt: "go",
      agentId: "codex",
      attachments: [makeAttachment("../escape")],
    });
    await finished(runs);
    expect(started).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.[1].kind).toBe("error");
    expect(await readdir(root)).toEqual([]);
  });

  test("runs up to MAX_CONCURRENT_RUNS at once, rejects the next, and frees a slot when one ends", async () => {
    const releases = new Map<string, () => void>();
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        await new Promise<void>((resolve) => releases.set(ctx.runId, resolve));
        ctx.emit({ kind: "done" });
      }),
    );
    for (const id of ["a", "b", "c"]) start(runs, id);
    await waitFor(() => releases.size === 3);
    expect(runs.activeCount()).toBe(MAX_CONCURRENT_RUNS);
    start(runs, "d");
    expect(events).toHaveLength(1);
    expect(events[0]?.[0]).toBe("d");
    expect(events[0]?.[1]).toMatchObject({ kind: "error" });
    expect((events[0]?.[1] as { message: string }).message).toContain("max 3");
    // A duplicate id is refused too.
    start(runs, "a");
    expect(events[1]).toEqual([
      "a",
      { kind: "error", message: "A run with this id is already in progress." },
    ]);
    releases.get("a")?.();
    await waitFor(() => runs.activeCount() === 2);
    start(runs, "e");
    await waitFor(() => releases.has("e"));
    for (const id of ["b", "c", "e"]) releases.get(id)?.();
    await finished(runs);
    expect(
      events
        .filter(([, e]) => e.kind === "done")
        .map(([id]) => id)
        .sort(),
    ).toEqual(["a", "b", "c", "e"]);
  });

  test("cancel ends one run and leaves the others running", async () => {
    const releases = new Map<string, () => void>();
    const aborted: string[] = [];
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        ctx.signal.addEventListener("abort", () => aborted.push(ctx.runId));
        await new Promise<void>((resolve) => {
          releases.set(ctx.runId, resolve);
          ctx.signal.addEventListener("abort", () => resolve());
        });
        if (!ctx.signal.aborted) ctx.emit({ kind: "done" });
      }),
    );
    for (const id of ["a", "b", "c"]) start(runs, id);
    await waitFor(() => releases.size === 3);
    runs.cancel("b");
    await waitFor(() => runs.activeCount() === 2);
    expect(aborted).toEqual(["b"]);
    expect(events).toEqual([["b", { kind: "error", message: "Run cancelled." }]]);
    releases.get("a")?.();
    releases.get("c")?.();
    await finished(runs);
    expect(events.filter(([, e]) => e.kind === "done").map(([id]) => id)).toEqual(["a", "c"]);
  });

  test("each concurrent run gets its own workdir and token, and the MCP server is bound to its run id", async () => {
    const seen = new Map<string, AgentRunContext>();
    const sources: unknown[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runs } = await setup(
      adapterOf(async (ctx) => {
        seen.set(ctx.runId, ctx);
        await gate;
        ctx.emit({ kind: "done" });
      }),
      {
        callTool: async (_tool, _input, source) => {
          sources.push(source);
          return { content: "", isError: false };
        },
      },
    );
    start(runs, "a");
    start(runs, "b");
    await waitFor(() => seen.size === 2);
    expect(seen.get("a")?.workdir).not.toBe(seen.get("b")?.workdir);
    expect(seen.get("a")?.mcpUrl).not.toBe(seen.get("b")?.mcpUrl);
    for (const id of ["a", "b"]) {
      const server = seen.get(id)?.createMcpServer?.();
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "t", version: "0" });
      await Promise.all([server?.connect(serverSide), client.connect(clientSide)]);
      await client.callTool({ name: "get_document", arguments: {} });
      await client.close();
    }
    expect(sources).toEqual([
      { kind: "run", runId: "a" },
      { kind: "run", runId: "b" },
    ]);
    release();
    await finished(runs);
  });

  describe("steer", () => {
    const nativeAdapter = (
      onCtx: (ctx: AgentRunContext, received: string[]) => Promise<void>,
      received: string[] = [],
    ): AgentAdapter => ({
      ...adapterOf(async (ctx) => onCtx(ctx, received)),
      steer: "native",
    });

    test("delivers to a native adapter (also when sent before it registers) and emits steered", async () => {
      const received: string[] = [];
      let release: () => void = () => undefined;
      let registered = false;
      const { runs, events } = await setup(
        nativeAdapter(async (ctx) => {
          await Bun.sleep(30);
          ctx.onSteer?.((steer) => {
            received.push(steer.text);
            return true;
          });
          registered = true;
          await new Promise<void>((resolve) => (release = resolve));
          ctx.emit({ kind: "done" });
        }),
      );
      start(runs, "a");
      await waitFor(() => runs.isRunning());
      await waitFor(async () => (await runs.steer("a", { text: "early" })) === "delivered");
      await waitFor(() => registered);
      expect(await runs.steer("a", { text: "later" })).toBe("delivered");
      expect(received).toEqual(["early", "later"]);
      expect(events.filter(([, e]) => e.kind === "steered").map(([, e]) => e)).toEqual([
        { kind: "steered", text: "early" },
        { kind: "steered", text: "later" },
      ]);
      release();
      await finished(runs);
      expect(await runs.steer("a", { text: "late" })).toBe("unknown");
    });

    test("attachments are written under a per-steer folder and keep their ids", async () => {
      const got: AgentRunContext["attachments"][] = [];
      let release: () => void = () => undefined;
      const { runs } = await setup(
        nativeAdapter(async (ctx) => {
          ctx.onSteer?.((steer) => {
            got.push(steer.attachments);
            return true;
          });
          await new Promise<void>((resolve) => (release = resolve));
          ctx.emit({ kind: "done" });
        }),
      );
      start(runs, "a");
      await waitFor(() => runs.isRunning());
      await Bun.sleep(20);
      const attachment = makeAttachment("att-1", "image/png");
      expect(await runs.steer("a", { text: "see", attachments: [attachment] })).toBe("delivered");
      expect(await runs.steer("a", { text: "again", attachments: [attachment] })).toBe("delivered");
      expect(got.map((list) => list?.[0]?.id)).toEqual(["att-1", "att-1"]);
      expect(got[0]?.[0]?.relativePath).toBe("steer-1/attachments/att-1.png");
      expect(got[1]?.[0]?.relativePath).toBe("steer-2/attachments/att-1.png");
      expect(existsSync(got[0]?.[0]?.path ?? "")).toBe(true);
      release();
      await finished(runs);
    });

    test("a restart adapter reports unsupported; an unknown run id is unknown", async () => {
      let release: () => void = () => undefined;
      const { runs } = await setup(
        adapterOf(async (ctx) => {
          await new Promise<void>((resolve) => (release = resolve));
          ctx.emit({ kind: "done" });
        }),
      );
      start(runs, "a");
      await waitFor(() => runs.isRunning());
      await Bun.sleep(20);
      expect(await runs.steer("a", { text: "x" })).toBe("unsupported");
      expect(await runs.steer("nope", { text: "x" })).toBe("unknown");
      release();
      await finished(runs);
    });
  });

  test("unknown agent id is an error and starts nothing", async () => {
    const { runs, events } = await setup(adapterOf(async () => undefined));
    runs.start({ runId: "x", prompt: "go", agentId: "gemini" });
    expect(events).toEqual([["x", { kind: "error", message: 'Unknown agent "gemini".' }]]);
    expect(runs.isRunning()).toBe(false);
  });

  test("temp workdir exists and is empty during the run, and is deleted afterwards", async () => {
    let workdir = "";
    let listing: string[] = ["unset"];
    const { runs, root } = await setup(
      adapterOf(async (ctx) => {
        workdir = ctx.workdir;
        listing = await readdir(ctx.workdir);
        await writeFile(join(ctx.workdir, "scratch.txt"), "x");
        ctx.emit({ kind: "done" });
      }),
    );
    start(runs);
    await finished(runs);
    expect(workdir.startsWith(await realpath(root))).toBe(true);
    expect(listing).toEqual([]);
    expect(existsSync(workdir)).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  test("workdir is cleaned up when the adapter throws; the run ends in one error event", async () => {
    let workdir = "";
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        workdir = ctx.workdir;
        throw new Error("kaboom");
      }),
    );
    start(runs);
    await finished(runs);
    expect(existsSync(workdir)).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.[1]).toEqual({ kind: "error", message: "codex failed: kaboom" });
  });

  test("an adapter that returns without done/error yields an error", async () => {
    const { runs, events } = await setup(adapterOf(async () => undefined));
    start(runs);
    await finished(runs);
    expect(events).toEqual([["r1", { kind: "error", message: "codex ended without a result." }]]);
  });

  test("only the first terminal event is delivered", async () => {
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        ctx.emit({ kind: "done" });
        ctx.emit({ kind: "error", message: "late" });
        ctx.emit({ kind: "text", text: "after" });
      }),
    );
    start(runs);
    await finished(runs);
    expect(events.map(([, e]) => e.kind)).toEqual(["done"]);
  });

  test("the run token resolves to its run only while the run is active", async () => {
    let url = "";
    let release: () => void = () => undefined;
    const { runs } = await setup(
      adapterOf(async (ctx) => {
        url = ctx.mcpUrl;
        await new Promise<void>((resolve) => (release = resolve));
        ctx.emit({ kind: "done" });
      }),
    );
    start(runs, "run-42");
    await waitFor(() => url !== "");
    const token = parseRunMcpPath(new URL(url).pathname);
    expect(token).toBeDefined();
    expect(runs.resolveRunToken(token as string)).toEqual({ runId: "run-42" });
    expect(runs.resolveRunToken("A".repeat(43))).toBeUndefined();
    release();
    await finished(runs);
    expect(runs.resolveRunToken(token as string)).toBeUndefined();
  });

  test("each run gets a fresh, unguessable token", async () => {
    const urls: string[] = [];
    const { runs } = await setup(
      adapterOf(async (ctx) => {
        urls.push(ctx.mcpUrl);
        ctx.emit({ kind: "done" });
      }),
    );
    start(runs, "a");
    await finished(runs);
    start(runs, "b");
    await finished(runs);
    expect(new Set(urls).size).toBe(2);
  });

  test("in-process MCP server attributes tool calls to the run", async () => {
    const calls: Array<{ tool: string; source: unknown }> = [];
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        const server = ctx.createMcpServer?.();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "t", version: "0" });
        await Promise.all([server?.connect(serverTransport), client.connect(clientTransport)]);
        await client.callTool({ name: "get_document", arguments: {} });
        await client.close();
        ctx.emit({ kind: "done" });
      }),
      {
        callTool: async (tool, _input, source) => {
          calls.push({ tool, source });
          return { content: "", isError: false };
        },
      },
    );
    start(runs, "r7");
    await finished(runs);
    expect(events.at(-1)?.[1]).toEqual({ kind: "done" });
    expect(calls).toEqual([{ tool: "get_document", source: { kind: "run", runId: "r7" } }]);
  });

  test("child env keeps PATH extended and drops API keys", async () => {
    let env: Record<string, string> = {};
    const { runs } = await setup(
      adapterOf(async (ctx) => {
        env = ctx.env;
        ctx.emit({ kind: "done" });
      }),
      {
        baseEnv: () => ({
          PATH: "/usr/bin",
          HOME: "/Users/test",
          ANTHROPIC_API_KEY: "sk-ant",
          OPENAI_API_KEY: "sk-openai",
          KEEP_ME: "yes",
        }),
      },
    );
    start(runs);
    await finished(runs);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.KEEP_ME).toBe("yes");
    for (const dir of ["/.local/bin", "/.opencode/bin", "/opt/homebrew/bin", "/usr/local/bin"]) {
      expect(env.PATH).toContain(dir);
    }
  });

  test("cancel kills the whole child process tree and cleans up", async () => {
    const root = await makeRoot();
    const pidFile = join(root, "pids");
    const bin = await makeFakeBin({
      slow: `sleep 60 &\necho "$$ $!" > ${JSON.stringify(pidFile)}\nwait`,
    });
    let workdir = "";
    const { runs, events } = await setup(
      adapterOf(async (ctx) => {
        workdir = ctx.workdir;
        await runCli({
          command: join(bin, "slow"),
          args: [],
          cwd: ctx.workdir,
          env: ctx.env,
          signal: ctx.signal,
          killGraceMs: 300,
        });
      }),
    );
    start(runs);
    expect(await waitFor(() => existsSync(pidFile))).toBe(true);
    await waitFor(async () => (await readFile(pidFile, "utf8")).trim().split(" ").length === 2);
    const [shellPid, sleepPid] = (await readFile(pidFile, "utf8"))
      .trim()
      .split(" ")
      .map(Number) as [number, number];
    expect(isAlive(shellPid) && isAlive(sleepPid)).toBe(true);
    runs.cancel("r1");
    await finished(runs);
    expect(await waitFor(() => !isAlive(shellPid) && !isAlive(sleepPid))).toBe(true);
    expect(events.at(-1)).toEqual(["r1", { kind: "error", message: "Run cancelled." }]);
    expect(existsSync(workdir)).toBe(false);
  });

  test("cancel for another run id does nothing; cancelAll aborts the active run", async () => {
    let aborted = false;
    const { runs } = await setup(
      adapterOf(async (ctx) => {
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }),
        );
      }),
    );
    start(runs, "a");
    runs.cancel("other");
    await Bun.sleep(20);
    expect(aborted).toBe(false);
    runs.cancelAll();
    await finished(runs);
    expect(aborted).toBe(true);
  });
});

describe("parseRunMcpPath", () => {
  test("accepts only well-formed tokens", () => {
    const token = "a".repeat(43);
    expect(parseRunMcpPath(`/mcp/run/${token}`)).toBe(token);
    expect(parseRunMcpPath("/mcp")).toBeUndefined();
    expect(parseRunMcpPath("/mcp/run/")).toBeUndefined();
    expect(parseRunMcpPath("/mcp/run/short")).toBeUndefined();
    expect(parseRunMcpPath(`/mcp/run/${token}/extra`)).toBeUndefined();
    expect(parseRunMcpPath(`/mcp/run/${token}%2F`)).toBeUndefined();
  });
});
