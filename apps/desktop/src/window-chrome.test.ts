import { expect, test } from "bun:test";
import {
  isThemeSource,
  parseMenuPoint,
  parseTitleBarArg,
  parseTitleBarOverlay,
  TITLE_BAR_ARG,
  windowChromeOptions,
} from "@/window-chrome";

test("macOS hides the title bar and centres the traffic lights in the 44px top row", () => {
  expect(windowChromeOptions("darwin")).toEqual({
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 15 },
  });
  expect(windowChromeOptions("darwin", "system")).toEqual(windowChromeOptions("darwin"));
});

test("Linux and Windows draw the window controls over the tab row by default", () => {
  for (const platform of ["linux", "win32"] as const) {
    expect(windowChromeOptions(platform)).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#141418", symbolColor: "#e4e4e7", height: 40 },
    });
  }
});

test("the system title bar keeps the native frame", () => {
  expect(windowChromeOptions("linux", "system")).toEqual({});
  expect(windowChromeOptions("win32", "system")).toEqual({});
  expect(windowChromeOptions("freebsd")).toEqual({});
});

test("only the editor's theme modes reach nativeTheme", () => {
  expect(["light", "dark", "system"].every(isThemeSource)).toBe(true);
  expect(isThemeSource("sepia")).toBe(false);
  expect(isThemeSource(undefined)).toBe(false);
});

test("the title bar argument is read back, anything else is null", () => {
  expect(parseTitleBarArg(["x", `${TITLE_BAR_ARG}pego`])).toBe("pego");
  expect(parseTitleBarArg([`${TITLE_BAR_ARG}system`])).toBe("system");
  expect(parseTitleBarArg([`${TITLE_BAR_ARG}fancy`])).toBeNull();
  expect(parseTitleBarArg([])).toBeNull();
});

test("overlay colors must be #rrggbb and the height a sane integer", () => {
  const good = { color: "#F4F4F5", symbolColor: "#18181b", height: 48 };
  expect(parseTitleBarOverlay(good)).toEqual(good);
  expect(parseTitleBarOverlay({ ...good, color: "red" })).toBeNull();
  expect(parseTitleBarOverlay({ ...good, symbolColor: "#fff" })).toBeNull();
  expect(parseTitleBarOverlay({ ...good, height: 12 })).toBeNull();
  expect(parseTitleBarOverlay({ ...good, height: 40.5 })).toBeNull();
  expect(parseTitleBarOverlay(null)).toBeNull();
});

test("menu points are rounded, finite, in range", () => {
  expect(parseMenuPoint({ x: 8.4, y: 40 })).toEqual({ x: 8, y: 40 });
  expect(parseMenuPoint({ x: -1, y: 0 })).toBeNull();
  expect(parseMenuPoint({ x: Number.NaN, y: 0 })).toBeNull();
  expect(parseMenuPoint("8,40")).toBeNull();
});
