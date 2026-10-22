import { describe, expect, test } from "bun:test";
import { reservesWindowControls } from "./window-controls";

const onFullScreenChange = () => () => {};

describe("reservesWindowControls", () => {
  test("macOS desktop app keeps room for the traffic lights", () => {
    expect(reservesWindowControls({ platform: "darwin", onFullScreenChange }, false)).toBe(true);
  });
  test("full screen hides the traffic lights, so no room is kept", () => {
    expect(reservesWindowControls({ platform: "darwin", onFullScreenChange }, true)).toBe(false);
  });
  test("plain browser, other platforms and builds without a hidden title bar keep the layout", () => {
    expect(reservesWindowControls(undefined, false)).toBe(false);
    expect(reservesWindowControls({ platform: "win32", onFullScreenChange }, false)).toBe(false);
    expect(reservesWindowControls({ platform: "darwin" }, false)).toBe(false);
  });
});
