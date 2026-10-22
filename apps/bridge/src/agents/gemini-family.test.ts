import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "@pego/agent";
import {
  bareToolName,
  describeFailure,
  isPegoTool,
  parseJsonLine,
  runFamilyCli,
  withSystemPrompt,
  type StreamParser,
} from "./gemini-family";

const jsonParser: StreamParser = {
  push: (line) => {
    const value = parseJsonLine(line);
    if (!value) return { events: [] };
    if (value.bad === true) return { events: [], violation: "tool not allowed" };
    if (value.done === true) return { events: [{ kind: "done" }] };
    return { events: [{ kind: "text", text: String(value.text ?? "") }] };
  },
};

const baseOptions = (script: string, signal: AbortSignal, events: RunEvent[]) => ({
  label: "Fake CLI",
  command: "/bin/sh",
  args: ["-c", script],
  env: { PATH: process.env.PATH ?? "" },
  cwd: tmpdir(),
  signal,
  emit: (event: RunEvent) => events.push(event),
  parser: jsonParser,
  loginHint: "log in please",
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("tool names", () => {
  test("strips qwen/gemini mcp prefixes, leaves other tools alone", () => {
    expect(bareToolName("mcp__pego__get_document")).toBe("get_document");
    expect(bareToolName("mcp_pego_get_document")).toBe("get_document");
    expect(bareToolName("run_shell_command")).toBe("run_shell_command");
    expect(isPegoTool("mcp_other_x")).toBe(false);
    expect(isPegoTool("mcp_pego_x")).toBe(true);
  });

  test("system prompt is prepended to the task", () => {
    expect(withSystemPrompt("SYS", "do")).toBe("SYS\n\n---\n\nTask:\ndo");
    expect(withSystemPrompt("  ", "do")).toBe("do");
  });
});

describe("describeFailure", () => {
  test("auth-looking stderr gives the login hint", () => {
    expect(describeFailure("X", ["Please set an Auth method"], 41, "log in")).toBe("log in");
  });
  test("otherwise the last meaningful stderr line", () => {
    expect(describeFailure("X", ["YOLO mode is enabled.", "boom happened"], 1, "log in")).toBe(
      "X stopped (exit 1): boom happened",
    );
  });
});

describe("runFamilyCli", () => {
  test("streams events from stdout and stops after the terminal one", async () => {
    const events: RunEvent[] = [];
    await runFamilyCli(
      baseOptions(
        `echo banner; echo '{"text":"hi"}'; echo '{"done":true}'`,
        new AbortController().signal,
        events,
      ),
    );
    expect(events).toEqual([{ kind: "text", text: "hi" }, { kind: "done" }]);
  });

  test("reads the prompt from stdin", async () => {
    const events: RunEvent[] = [];
    await runFamilyCli({
      ...baseOptions(`read x; echo "{\\"text\\":\\"$x\\"}"`, new AbortController().signal, events),
      stdin: "hello\n",
    });
    expect(events).toEqual([
      { kind: "text", text: "hello" },
      { kind: "error", message: expect.any(String) },
    ]);
  });

  test("a failing process without a result becomes one error event", async () => {
    const events: RunEvent[] = [];
    await runFamilyCli(
      baseOptions(`echo "unauthorized" >&2; exit 3`, new AbortController().signal, events),
    );
    expect(events).toEqual([{ kind: "error", message: "log in please" }]);
  });

  test("a parser violation stops the run with an error", async () => {
    const events: RunEvent[] = [];
    const started = Date.now();
    await runFamilyCli(
      baseOptions(`echo '{"bad":true}'; sleep 30`, new AbortController().signal, events),
    );
    expect(events).toEqual([{ kind: "error", message: "tool not allowed" }]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("abort kills the whole process tree promptly and emits nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pego-abort-"));
    const pidFile = join(dir, "pid");
    const events: RunEvent[] = [];
    const abort = new AbortController();
    const started = Date.now();
    // grandchild `sleep` records its pid so we can prove it died with the group
    const run = runFamilyCli(
      baseOptions(
        `(sleep 60 & echo $! > ${pidFile}; wait) & echo '{"text":"start"}'; while true; do sleep 0.1; done`,
        abort.signal,
        events,
      ),
    );
    await Bun.sleep(600);
    abort.abort();
    await run;
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(events).toEqual([{ kind: "text", text: "start" }]);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    await Bun.sleep(200);
    expect(alive(pid)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  test("an already aborted signal never starts the process", async () => {
    const events: RunEvent[] = [];
    const abort = new AbortController();
    abort.abort();
    await runFamilyCli(baseOptions('echo \'{"text":"x"}\'', abort.signal, events));
    expect(events).toEqual([]);
  });
});
