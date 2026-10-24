import { describe, expect, test } from "bun:test";
import { channelLockHint, describeUpdate } from "./update-view";
import { moveTabFocus } from "./tab-nav";

describe("describeUpdate", () => {
  test("idle shows no text", () => expect(describeUpdate({ state: "idle" }).text).toBe(""));
  test("checking disables the button", () =>
    expect(describeUpdate({ state: "checking" })).toMatchObject({ busy: true, action: "check" }));
  test("up to date", () =>
    expect(describeUpdate({ state: "not-available", checkedAt: 1 }).text).toBe(
      "Pego is up to date.",
    ));
  test("downloading clamps percent", () => {
    const v = describeUpdate({ state: "downloading", version: "1.2.0", percent: 140.4 });
    expect(v.percent).toBe(100);
    expect(v.text).toContain("1.2.0");
  });
  test("ready offers restart", () =>
    expect(describeUpdate({ state: "ready", version: "1.2.0" }).action).toBe("restart"));
  test("error keeps checking possible", () =>
    expect(describeUpdate({ state: "error", message: "offline" })).toMatchObject({
      tone: "error",
      action: "check",
      busy: false,
    }));
});

describe("moveTabFocus", () => {
  test("wraps", () => {
    expect(moveTabFocus(3, "ArrowDown", 4)).toBe(0);
    expect(moveTabFocus(0, "ArrowUp", 4)).toBe(3);
  });
  test("home and end", () => {
    expect(moveTabFocus(2, "Home", 4)).toBe(0);
    expect(moveTabFocus(1, "End", 4)).toBe(3);
  });
  test("ignores other keys", () => expect(moveTabFocus(1, "a", 4)).toBeNull());
});

describe("channelLockHint", () => {
  test("locks the channel on macOS while an update is ready", () => {
    expect(channelLockHint({ state: "ready", version: "1.0.0" }, "darwin")).toContain("Restart");
    expect(channelLockHint({ state: "ready", version: "1.0.0" }, "win32")).toBeNull();
    expect(
      channelLockHint({ state: "downloading", version: "1.0.0", percent: 3 }, "darwin"),
    ).toBeNull();
    expect(channelLockHint({ state: "idle" }, "darwin")).toBeNull();
  });
});
