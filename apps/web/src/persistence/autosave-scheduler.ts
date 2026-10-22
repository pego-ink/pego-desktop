/**
 * Pure scheduling for file autosave: idle debounce, a max wait during continuous editing,
 * serialized writes (one in flight, the latest state queued) and stale-write detection.
 * No DOM or store access; time is injectable for tests.
 */
export type SchedulerTimers = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const realTimers: SchedulerTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type SchedulerOptions = {
  /** Quiet period after the last change before writing. */
  idleMs: number;
  /** Longest a change may wait for a write while edits keep arriving. */
  maxWaitMs: number;
  /** Writes the latest state. Must read current state itself when it starts. */
  write: () => Promise<void>;
  /** Called once when an autosave write fails; the scheduler pauses itself. */
  onError?: (error: unknown) => void;
  timers?: SchedulerTimers;
};

const noop = () => {};

export const createAutosaveScheduler = (options: SchedulerOptions) => {
  const timers = options.timers ?? realTimers;
  let timer: unknown = null;
  let firstChangeAt: number | null = null;
  let paused = false;
  let queued = 0;
  let autoQueued: Promise<void> | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  const clearTimer = () => {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  };

  /** Runs jobs strictly one after another, whatever their outcome. */
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    queued += 1;
    const result = tail.then(async () => {
      try {
        return await job();
      } finally {
        queued -= 1;
      }
    });
    tail = result.catch(noop);
    return result;
  };

  const runAuto = (): Promise<void> => {
    if (paused) return Promise.resolve();
    // A write that has not started yet will read the latest state anyway.
    if (autoQueued) return autoQueued;
    const run = enqueue(async () => {
      autoQueued = null;
      firstChangeAt = null;
      if (paused) return;
      try {
        await options.write();
      } catch (error) {
        paused = true;
        clearTimer();
        options.onError?.(error);
      }
    });
    autoQueued = run;
    return run;
  };

  /** Registers an edit and (re)arms the debounce, bounded by the max wait. */
  const notifyChange = () => {
    if (paused) return;
    const now = timers.now();
    firstChangeAt ??= now;
    clearTimer();
    const delay = Math.max(0, Math.min(options.idleMs, firstChangeAt + options.maxWaitMs - now));
    timer = timers.setTimeout(() => {
      timer = null;
      void runAuto();
    }, delay);
  };

  return {
    notifyChange,
    /** Writes now (skipping the debounce); resolves when that write has finished. */
    flush: () => {
      clearTimer();
      return runAuto();
    },
    /** Runs a manual save in the same queue; cancels any pending debounce. */
    exclusive: <T>(job: () => Promise<T>) => {
      clearTimer();
      firstChangeAt = null;
      return enqueue(job);
    },
    cancel: () => {
      clearTimer();
      firstChangeAt = null;
    },
    pause: () => {
      paused = true;
      clearTimer();
      firstChangeAt = null;
    },
    resume: () => {
      paused = false;
    },
    isPaused: () => paused,
    /** A debounce is armed. */
    isScheduled: () => timer !== null,
    /** A write is running or queued. */
    isWriting: () => queued > 0,
  };
};

export type AutosaveScheduler = ReturnType<typeof createAutosaveScheduler>;

/**
 * A finished write may only mark the document clean if neither the document nor the
 * target file changed while it was in flight.
 */
export const canMarkClean = <D, H>(
  start: { doc: D; handle: H },
  now: { doc: D; handle: H },
): boolean => start.doc === now.doc && start.handle === now.handle;
