import { expect, test } from "bun:test";
import { windowChromeOptions } from "@/window-chrome";

test("macOS hides the title bar and centres the traffic lights in the 44px top row", () => {
  expect(windowChromeOptions("darwin")).toEqual({
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 15 },
  });
});

test("other platforms keep the native frame", () => {
  expect(windowChromeOptions("win32")).toEqual({});
  expect(windowChromeOptions("linux")).toEqual({});
});
