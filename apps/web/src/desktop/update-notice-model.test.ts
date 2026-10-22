import { describe, expect, test } from "bun:test";
import { clampPercent, noticeTitle, noticeView, sameNoticeView } from "./update-notice-model";

describe("noticeView", () => {
  test("quiet states render nothing", () => {
    expect(noticeView({ state: "idle" }, null)).toBeNull();
    expect(noticeView({ state: "checking" }, null)).toBeNull();
    expect(noticeView({ state: "available", version: "0.0.2" }, null)).toBeNull();
    expect(noticeView({ state: "not-available", checkedAt: 1 }, null)).toBeNull();
    expect(noticeView({ state: "error", message: "x" }, null)).toBeNull();
  });
  test("downloading shows clamped progress", () => {
    expect(noticeView({ state: "downloading", version: "0.0.2", percent: 140 }, null)).toEqual({
      kind: "downloading",
      version: "0.0.2",
      percent: 100,
    });
  });
  test("ready shows until dismissed, then returns for a newer version", () => {
    const ready = { state: "ready", version: "0.0.2" } as const;
    expect(noticeView(ready, null)).toEqual({ kind: "ready", version: "0.0.2" });
    expect(noticeView(ready, "0.0.2")).toBeNull();
    expect(noticeView({ state: "ready", version: "0.0.3" }, "0.0.2")).not.toBeNull();
  });
});

describe("helpers", () => {
  test("clampPercent", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(33.6)).toBe(34);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
  test("noticeTitle", () => {
    expect(noticeTitle({ kind: "ready", version: "0.0.2" })).toBe("Pego 0.0.2 is ready");
    expect(noticeTitle({ kind: "downloading", version: "", percent: 3 })).toBe(
      "Downloading The update",
    );
  });
  test("sameNoticeView", () => {
    const d = { kind: "downloading", version: "1", percent: 5 } as const;
    expect(sameNoticeView(null, d)).toBe(false);
    expect(sameNoticeView(d, { ...d })).toBe(true);
    expect(sameNoticeView(d, { ...d, percent: 6 })).toBe(false);
    expect(sameNoticeView(d, { kind: "ready", version: "1" })).toBe(false);
  });
});
