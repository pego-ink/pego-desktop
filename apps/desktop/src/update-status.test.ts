import { describe, expect, test } from "bun:test";
import {
  IDLE_STATUS,
  isTrustedSender,
  isUpdateStatus,
  normalizeReleaseNotes,
  parseVersionArg,
  reduceUpdaterEvent,
  type UpdateStatus,
} from "@/update-status";

describe("reduceUpdaterEvent", () => {
  test("walks checking -> available -> downloading -> ready", () => {
    let s: UpdateStatus = IDLE_STATUS;
    s = reduceUpdaterEvent(s, { type: "checking" });
    expect(s).toEqual({ state: "checking" });
    s = reduceUpdaterEvent(s, { type: "available", info: { version: "0.0.2" } });
    expect(s).toEqual({ state: "available", version: "0.0.2" });
    s = reduceUpdaterEvent(s, { type: "progress", percent: 42.4 });
    expect(s).toEqual({ state: "downloading", version: "0.0.2", percent: 42 });
    s = reduceUpdaterEvent(s, {
      type: "downloaded",
      info: { version: "0.0.2", releaseNotes: "<p>Hi</p>" },
    });
    expect(s).toEqual({ state: "ready", version: "0.0.2", releaseNotes: "Hi" });
  });

  test("clamps progress", () => {
    expect(reduceUpdaterEvent(IDLE_STATUS, { type: "progress", percent: 250 })).toMatchObject({
      percent: 100,
    });
    expect(
      reduceUpdaterEvent(IDLE_STATUS, { type: "progress", percent: Number.NaN }),
    ).toMatchObject({ percent: 0 });
  });

  test("a ready update survives later checks and errors", () => {
    const ready: UpdateStatus = { state: "ready", version: "1.0.0" };
    expect(reduceUpdaterEvent(ready, { type: "checking" })).toBe(ready);
    expect(reduceUpdaterEvent(ready, { type: "error", error: new Error("net") })).toBe(ready);
  });

  test("maps errors to a short single-line message", () => {
    const s = reduceUpdaterEvent(IDLE_STATUS, {
      type: "error",
      error: new Error("boom\nstack line"),
    });
    expect(s).toEqual({ state: "error", message: "boom" });
    expect(reduceUpdaterEvent(IDLE_STATUS, { type: "error", error: 5 })).toEqual({
      state: "error",
      message: "Update check failed",
    });
  });

  test("not-available carries the check time", () => {
    expect(reduceUpdaterEvent(IDLE_STATUS, { type: "not-available", now: 7 })).toEqual({
      state: "not-available",
      checkedAt: 7,
    });
  });
});

describe("normalizeReleaseNotes", () => {
  test("strips html and joins note arrays", () => {
    expect(
      normalizeReleaseNotes("<h2>New</h2><ul><li>a &amp; b</li></ul><script>x()</script>"),
    ).toBe("New\na & b\nx()");
    expect(
      normalizeReleaseNotes([
        { version: "1", note: "one" },
        { version: "2", note: "two" },
      ]),
    ).toBe("one\n\ntwo");
    expect(normalizeReleaseNotes(null)).toBeUndefined();
  });
  test("caps length", () => {
    expect(normalizeReleaseNotes("x".repeat(9000))?.length).toBe(4000);
  });
});

describe("isUpdateStatus", () => {
  test("accepts every valid state", () => {
    const valid: unknown[] = [
      { state: "idle" },
      { state: "checking" },
      { state: "not-available", checkedAt: 1 },
      { state: "available", version: "1.0.0", releaseNotes: "n" },
      { state: "downloading", version: "1.0.0", percent: 50 },
      { state: "ready", version: "1.0.0" },
      { state: "error", message: "x" },
    ];
    for (const v of valid) expect(isUpdateStatus(v)).toBe(true);
  });
  test("rejects malformed payloads", () => {
    const invalid: unknown[] = [
      null,
      "ready",
      {},
      { state: "bogus" },
      { state: "ready" },
      { state: "ready", version: 4 },
      { state: "downloading", version: "1", percent: 101 },
      { state: "downloading", version: "1", percent: "5" },
      { state: "error", message: "x".repeat(1000) },
      { state: "not-available", checkedAt: Number.NaN },
      { state: "available", version: "1", releaseNotes: 5 },
    ];
    for (const v of invalid) expect(isUpdateStatus(v)).toBe(false);
  });
});

describe("isTrustedSender", () => {
  test("only the app origin passes", () => {
    expect(isTrustedSender("app://pego/index.html", "app://pego")).toBe(true);
    expect(isTrustedSender("https://evil.example/", "app://pego")).toBe(false);
    expect(isTrustedSender("app://pego.evil/", "app://pego")).toBe(false);
    expect(isTrustedSender(undefined, "app://pego")).toBe(false);
    expect(isTrustedSender("not a url", "app://pego")).toBe(false);
  });
});

describe("parseVersionArg", () => {
  test("reads a valid version, falls back otherwise", () => {
    expect(parseVersionArg(["x", "--pego-version=0.0.2-beta"])).toBe("0.0.2-beta");
    expect(parseVersionArg(["x"])).toBe("0.0.0");
    expect(parseVersionArg(["--pego-version=<script>"])).toBe("0.0.0");
  });
});
