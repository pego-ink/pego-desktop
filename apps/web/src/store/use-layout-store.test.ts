import { describe, expect, test } from "bun:test";
import { showProperties } from "./use-layout-store";

describe("showProperties", () => {
  test("hidden with no selection unless pinned", () => {
    expect(showProperties(0, false)).toBe(false);
    expect(showProperties(0, true)).toBe(true);
    expect(showProperties(2, false)).toBe(true);
  });

  test("shown while the frame tool is active", () => {
    expect(showProperties(0, false, true)).toBe(true);
    expect(showProperties(0, false, false)).toBe(false);
  });
});
