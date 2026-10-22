import { describe, expect, test } from "bun:test";
import { screenshotScale } from "./browser-host";

describe("screenshotScale", () => {
  const box = { x: 0, y: 0, width: 1000, height: 4000 };
  test("shrinks to fit the longer side", () => {
    expect(screenshotScale(box, 2000)).toBe(0.5);
  });
  test("never enlarges", () => {
    expect(screenshotScale(box, 10000)).toBe(1);
  });
});
