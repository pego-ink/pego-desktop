import { describe, expect, test } from "bun:test";
import { isCloseTabKey, isMenuCommand } from "@/menu-channels";

describe("isMenuCommand", () => {
  test("accepts known commands only", () => {
    expect(isMenuCommand("select-all")).toBe(true);
    expect(isMenuCommand("close-tab")).toBe(true);
    expect(isMenuCommand("quit")).toBe(false);
    expect(isMenuCommand(undefined)).toBe(false);
    expect(isMenuCommand({ command: "select-all" })).toBe(false);
  });
});

test("Close Tab in the built-in browser is Ctrl+W, or Cmd+W on macOS, alone", () => {
  const key = { type: "keyDown", key: "w", control: false, meta: false, shift: false, alt: false };
  expect(isCloseTabKey({ ...key, control: true }, "linux")).toBe(true);
  expect(isCloseTabKey({ ...key, key: "W", control: true }, "win32")).toBe(true);
  expect(isCloseTabKey({ ...key, meta: true }, "darwin")).toBe(true);
  expect(isCloseTabKey({ ...key, control: true }, "darwin")).toBe(false);
  expect(isCloseTabKey({ ...key, control: true, shift: true }, "linux")).toBe(false);
  expect(isCloseTabKey({ ...key, control: true, type: "keyUp" }, "linux")).toBe(false);
  expect(isCloseTabKey({ ...key, key: "q", control: true }, "linux")).toBe(false);
});
