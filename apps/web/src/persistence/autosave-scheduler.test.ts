/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { canMarkClean, createAutosaveScheduler, type SchedulerTimers } from "./autosave-scheduler";

const createClock = () => {
  let time = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: SchedulerTimers = {
    now: () => time,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimeout: (id) => void pending.delete(id as number),
  };
  const advance = async (ms: number) => {
    const target = time + ms;
    for (;;) {
      const due = [...pending.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      time = due[1].at;
      due[1].fn();
      await tick();
    }
    time = target;
    await tick();
  };
  return { timers, advance };
};

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const setup = (write?: () => Promise<void>) => {
  const clock = createClock();
  const writes: number[] = [];
  const scheduler = createAutosaveScheduler({
    idleMs: 1500,
    maxWaitMs: 10_000,
    timers: clock.timers,
    write: write ?? (async () => void writes.push(1)),
  });
  return { ...clock, scheduler, writes };
};

describe("autosave scheduler", () => {
  test("writes once after the idle period", async () => {
    const { scheduler, advance, writes } = setup();
    scheduler.notifyChange();
    await advance(1499);
    expect(writes.length).toBe(0);
    await advance(1);
    expect(writes.length).toBe(1);
  });

  test("keeps debouncing while edits keep arriving", async () => {
    const { scheduler, advance, writes } = setup();
    for (let i = 0; i < 5; i++) {
      scheduler.notifyChange();
      await advance(1000);
    }
    expect(writes.length).toBe(0);
    await advance(1500);
    expect(writes.length).toBe(1);
  });

  test("writes at the max wait during continuous editing", async () => {
    const { scheduler, advance, writes } = setup();
    for (let i = 0; i < 10; i++) {
      scheduler.notifyChange();
      await advance(1000);
    }
    expect(writes.length).toBe(1);
    // A new window starts after that write.
    for (let i = 0; i < 10; i++) {
      scheduler.notifyChange();
      await advance(1000);
    }
    expect(writes.length).toBe(2);
  });

  test("never overlaps writes and coalesces the queue to one follow-up", async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const gates: Array<() => void> = [];
    const { scheduler, advance } = setup(async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
    });
    scheduler.notifyChange();
    await advance(1500);
    expect(calls).toBe(1);
    expect(scheduler.isWriting()).toBe(true);
    // Several debounces expire while the first write is still in flight.
    for (let i = 0; i < 3; i++) {
      scheduler.notifyChange();
      await advance(1500);
    }
    expect(calls).toBe(1);
    gates.shift()?.();
    await tick();
    expect(calls).toBe(2);
    gates.shift()?.();
    await tick();
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    expect(scheduler.isWriting()).toBe(false);
  });

  test("flush writes immediately and cancels the debounce", async () => {
    const { scheduler, advance, writes } = setup();
    scheduler.notifyChange();
    await scheduler.flush();
    expect(writes.length).toBe(1);
    expect(scheduler.isScheduled()).toBe(false);
    await advance(5000);
    expect(writes.length).toBe(1);
  });

  test("exclusive jobs wait for an in-flight write and cancel the debounce", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const { scheduler, advance } = setup(async () => {
      order.push("auto:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("auto:end");
    });
    scheduler.notifyChange();
    await advance(1500);
    scheduler.notifyChange();
    const manual = scheduler.exclusive(async () => void order.push("manual"));
    expect(scheduler.isScheduled()).toBe(false);
    await tick();
    expect(order).toEqual(["auto:start"]);
    release();
    await manual;
    expect(order).toEqual(["auto:start", "auto:end", "manual"]);
  });

  test("a failing write pauses autosave and reports once", async () => {
    const errors: unknown[] = [];
    const clock = createClock();
    let calls = 0;
    const scheduler = createAutosaveScheduler({
      idleMs: 1500,
      maxWaitMs: 10_000,
      timers: clock.timers,
      write: async () => {
        calls += 1;
        throw new Error("disk full");
      },
      onError: (error) => errors.push(error),
    });
    scheduler.notifyChange();
    await clock.advance(1500);
    expect(calls).toBe(1);
    expect(errors.length).toBe(1);
    expect(scheduler.isPaused()).toBe(true);
    scheduler.notifyChange();
    await clock.advance(20_000);
    expect(calls).toBe(1);
    // Manual saves still run, and resume re-enables autosave.
    let manual = false;
    await scheduler.exclusive(async () => void (manual = true));
    expect(manual).toBe(true);
    scheduler.resume();
    scheduler.notifyChange();
    await clock.advance(1500);
    expect(calls).toBe(2);
  });

  test("canMarkClean rejects a doc or handle that changed during the write", () => {
    const doc = {};
    const handle = {};
    expect(canMarkClean({ doc, handle }, { doc, handle })).toBe(true);
    expect(canMarkClean({ doc, handle }, { doc: {}, handle })).toBe(false);
    expect(canMarkClean({ doc, handle }, { doc, handle: {} })).toBe(false);
  });
});
