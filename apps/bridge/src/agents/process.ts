import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const STDERR_TAIL_LINES = 20;
/** JSONL events can carry whole document dumps; only guard against runaway output. */
const MAX_LINE_CHARS = 16 * 1024 * 1024;
const MAX_STDERR_LINE_CHARS = 1000;
const DEFAULT_KILL_GRACE_MS = 2000;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export const stripAnsi = (text: string): string => text.replace(ANSI, "");

export type CliProcessOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  /** Written to the child's stdin, then closed. Without it stdin is /dev/null. */
  stdin?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  killGraceMs?: number;
};

export type CliResult = {
  exitCode: number | null;
  /** Terminating signal, if any. */
  signal: string | null;
  /** The run was stopped through `signal`. */
  aborted: boolean;
  /** Last stderr lines (ANSI stripped), oldest first. */
  stderrTail: string[];
  /** The process could not be started at all. */
  spawnError?: string;
};

/** SIGTERM/SIGKILL the whole process group (the child is spawned as a group leader). */
export const killProcessTree = (pid: number, signal: NodeJS.Signals): void => {
  if (process.platform === "win32") {
    try {
      Bun.spawn(["taskkill", "/pid", String(pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      // nothing left to kill
    }
    return;
  }
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // not a group leader any more (or already gone)
  }
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
};

const createLineSplitter = (onLine: (line: string) => void) => {
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (line: string) => {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean !== "")
      onLine(clean.length > MAX_LINE_CHARS ? clean.slice(0, MAX_LINE_CHARS) : clean);
  };
  return {
    push: (chunk: Uint8Array) => {
      buffer += decoder.decode(chunk, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        emit(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
      // A single huge line without newline must not grow without bound.
      if (buffer.length > MAX_LINE_CHARS) buffer = buffer.slice(-MAX_LINE_CHARS);
    },
    flush: () => {
      buffer += decoder.decode();
      if (buffer !== "") emit(buffer);
      buffer = "";
    },
  };
};

/**
 * Run a CLI as a process-group leader, stream stdout/stderr by line, and kill the whole tree
 * (SIGTERM, then SIGKILL after a grace period) when `signal` aborts. Never rejects.
 */
export const runCli = async (options: CliProcessOptions): Promise<CliResult> => {
  const stderrTail: string[] = [];
  let aborted = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([options.command, ...options.args], {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdin: options.stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      exitCode: null,
      signal: null,
      aborted,
      stderrTail,
      spawnError: error instanceof Error ? error.message : String(error),
    };
  }
  const pid = proc.pid;

  const onAbort = () => {
    aborted = true;
    killProcessTree(pid, "SIGTERM");
    killTimer = setTimeout(
      () => killProcessTree(pid, "SIGKILL"),
      options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    );
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  if (options.stdin !== undefined && proc.stdin && typeof proc.stdin !== "number") {
    try {
      proc.stdin.write(options.stdin);
      await proc.stdin.end();
    } catch {
      // the child may exit before reading its prompt; its exit code tells the story
    }
  }

  const pump = async (
    stream: ReadableStream<Uint8Array> | number | undefined,
    onLine: (line: string) => void,
  ) => {
    if (!stream || typeof stream === "number") return;
    const splitter = createLineSplitter(onLine);
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        splitter.push(value);
      }
    } catch {
      // stream closed under us
    }
    splitter.flush();
  };

  const pumps = Promise.all([
    pump(proc.stdout, (line) => options.onStdoutLine?.(line)),
    pump(proc.stderr, (line) => {
      const clean = stripAnsi(line);
      stderrTail.push(clean.slice(0, MAX_STDERR_LINE_CHARS));
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      options.onStderrLine?.(clean);
    }),
  ]);

  const exitCode = await proc.exited;
  // Reap stragglers (grandchildren) so no pipe stays open and nothing outlives the run.
  killProcessTree(pid, "SIGKILL");
  await pumps;
  if (killTimer) clearTimeout(killTimer);
  options.signal?.removeEventListener("abort", onAbort);
  return {
    exitCode: proc.signalCode ? null : exitCode,
    signal: proc.signalCode ? String(proc.signalCode) : null,
    aborted,
    stderrTail,
  };
};

export type CaptureResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
};

/** Run a short CLI command and collect its output; killed after `timeoutMs`. */
export const runCapture = async (
  command: string,
  args: string[],
  options: { env: Record<string, string>; timeoutMs: number; cwd?: string },
): Promise<CaptureResult> => {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, options.timeoutMs);
  const out: string[] = [];
  const err: string[] = [];
  const result = await runCli({
    command,
    args,
    cwd: options.cwd ?? process.cwd(),
    env: options.env,
    signal: abort.signal,
    killGraceMs: 500,
    onStdoutLine: (line) => out.push(line),
    onStderrLine: (line) => err.push(line),
  });
  clearTimeout(timer);
  return {
    stdout: out.join("\n"),
    stderr: err.join("\n"),
    exitCode: result.exitCode,
    timedOut,
    ...(result.spawnError ? { spawnError: result.spawnError } : {}),
  };
};

const isExecutable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Every executable called `name` on `env.PATH`, in PATH order, without duplicates. */
export const findExecutables = (name: string, env: Record<string, string>): string[] => {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const found: string[] = [];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const candidate of names) {
      const full = join(dir, candidate);
      if (!found.includes(full) && isExecutable(full)) found.push(full);
    }
  }
  return found;
};

/**
 * First candidate that answers `--version`, plus the version line. Skips dangling installs
 * (e.g. a stale Homebrew shim earlier on PATH).
 */
export const probeVersion = async (
  candidates: string[],
  env: Record<string, string>,
  timeoutMs = 5000,
): Promise<{ path: string; version: string } | undefined> => {
  for (const path of candidates) {
    const result = await runCapture(path, ["--version"], { env, timeoutMs });
    if (result.exitCode !== 0) continue;
    const line = result.stdout.split("\n").find((l) => l.trim() !== "");
    if (line) return { path, version: line.trim() };
  }
  return undefined;
};

/** Pull a dotted version number out of free text ("codex-cli 0.160.0" -> "0.160.0"). */
export const extractVersion = (text: string): string =>
  /\d+\.\d+\.\d+[\w.-]*/.exec(text)?.[0] ?? text;
