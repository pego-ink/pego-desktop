import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildChildEnv } from "./env";
import { isAlive, makeFakeBin, waitFor } from "./fake-cli";
import {
  extractVersion,
  findExecutables,
  probeVersion,
  runCapture,
  runCli,
  stripAnsi,
} from "./process";

const env = buildChildEnv({ PATH: "/usr/bin:/bin" });
const cwd = process.cwd();

describe("runCli", () => {
  test("streams stdout and stderr by line, delivers stdin, reports the exit code", async () => {
    const bin = await makeFakeBin({
      t: 'read prompt\necho "got:$prompt"\necho "out2"\necho "e1" >&2\nprintf "partial"\nexit 3',
    });
    const out: string[] = [];
    const err: string[] = [];
    const result = await runCli({
      command: join(bin, "t"),
      args: [],
      cwd,
      env,
      stdin: "hello\n",
      onStdoutLine: (l) => out.push(l),
      onStderrLine: (l) => err.push(l),
    });
    expect(out).toEqual(["got:hello", "out2", "partial"]);
    expect(err).toEqual(["e1"]);
    expect(result).toMatchObject({ exitCode: 3, aborted: false, stderrTail: ["e1"] });
  });

  test("keeps only the last stderr lines, ANSI stripped", async () => {
    const bin = await makeFakeBin({
      t: 'i=1\nwhile [ $i -le 30 ]; do printf "\\033[31mline%s\\033[0m\\n" $i >&2; i=$((i+1)); done',
    });
    const result = await runCli({ command: join(bin, "t"), args: [], cwd, env });
    expect(result.stderrTail).toHaveLength(20);
    expect(result.stderrTail[0]).toBe("line11");
    expect(result.stderrTail.at(-1)).toBe("line30");
  });

  test("a missing executable resolves with a spawnError instead of throwing", async () => {
    const result = await runCli({ command: "/nonexistent/pego-cli", args: [], cwd, env });
    expect(result.exitCode).toBeNull();
    expect(result.spawnError).toBeDefined();
  });

  test("passes very long JSONL lines through intact", async () => {
    const bin = await makeFakeBin({ t: 'head -c 3000000 /dev/zero | tr "\\0" "a"; echo' });
    const lines: string[] = [];
    await runCli({
      command: join(bin, "t"),
      args: [],
      cwd,
      env,
      onStdoutLine: (l) => lines.push(l),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBe(3_000_000);
  });

  test("abort kills the child and its grandchildren; a TERM-ignoring child is killed after the grace", async () => {
    const dir = await makeFakeBin({
      t: 'trap "" TERM\nsleep 60 &\necho "$$ $!" > "$1"\nwait',
    });
    const pidFile = join(dir, "pids");
    const abort = new AbortController();
    const running = runCli({
      command: join(dir, "t"),
      args: [pidFile],
      cwd,
      env,
      signal: abort.signal,
      killGraceMs: 200,
    });
    await waitFor(
      async () => existsSync(pidFile) && (await readFile(pidFile, "utf8")).includes(" "),
    );
    const [shell, sleeper] = (await readFile(pidFile, "utf8")).trim().split(" ").map(Number) as [
      number,
      number,
    ];
    abort.abort();
    const result = await running;
    expect(result.aborted).toBe(true);
    expect(await waitFor(() => !isAlive(shell) && !isAlive(sleeper))).toBe(true);
  });

  test("an already aborted signal never leaves a process behind", async () => {
    const dir = await makeFakeBin({ t: 'echo $$ > "$1"\nsleep 60' });
    const pidFile = join(dir, "pid");
    const result = await runCli({
      command: join(dir, "t"),
      args: [pidFile],
      cwd,
      env,
      signal: AbortSignal.abort(),
      killGraceMs: 100,
    });
    expect(result.aborted).toBe(true);
    if (existsSync(pidFile)) {
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      expect(await waitFor(() => !isAlive(pid))).toBe(true);
    }
  });
});

describe("runCapture", () => {
  test("collects output and reports a timeout by killing the process", async () => {
    const bin = await makeFakeBin({ ok: "echo hello", slow: "sleep 30" });
    expect((await runCapture(join(bin, "ok"), [], { env, timeoutMs: 5000 })).stdout).toBe("hello");
    const slow = await runCapture(join(bin, "slow"), [], { env, timeoutMs: 100 });
    expect(slow.timedOut).toBe(true);
  });
});

describe("executable discovery", () => {
  test("findExecutables lists PATH matches in order; probeVersion skips broken installs", async () => {
    const broken = await makeFakeBin({ tool: "exit 1" });
    const good = await makeFakeBin({ tool: 'echo "tool v1.2.3"' });
    const pathEnv = { PATH: `${broken}:${good}:/does/not/exist` };
    expect(findExecutables("tool", pathEnv)).toEqual([join(broken, "tool"), join(good, "tool")]);
    expect(await probeVersion(findExecutables("tool", pathEnv), env)).toEqual({
      path: join(good, "tool"),
      version: "tool v1.2.3",
    });
    expect(await probeVersion([], env)).toBeUndefined();
    expect(findExecutables("missing-tool", pathEnv)).toEqual([]);
  });

  test("extractVersion and stripAnsi", () => {
    expect(extractVersion("codex-cli 0.160.0")).toBe("0.160.0");
    expect(extractVersion("opencode v2.0.32")).toBe("2.0.32");
    expect(extractVersion("2.1.308 (Claude Code)")).toBe("2.1.308");
    expect(extractVersion("nothing")).toBe("nothing");
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });
});
