import { describe, expect, test } from "bun:test";
import { parseEmulation } from "@/browser-emulation";

const valid = {
  width: 820,
  height: 1180,
  screenWidth: 820,
  screenHeight: 1180,
  scale: 0.63,
  mobile: true,
};

describe("parseEmulation", () => {
  test("accepts a valid emulation and null", () => {
    expect(parseEmulation(valid)).toEqual(valid);
    expect(parseEmulation(null)).toBeNull();
  });

  test("rejects malformed payloads", () => {
    for (const bad of [
      undefined,
      "x",
      [],
      { ...valid, width: 0 },
      { ...valid, height: 10_001 },
      { ...valid, screenWidth: Number.NaN },
      { ...valid, scale: 0.01 },
      { ...valid, scale: 1.5 },
      { ...valid, scale: Infinity },
      { ...valid, mobile: "yes" },
      { ...valid, width: "820" },
    ])
      expect(parseEmulation(bad)).toBeUndefined();
  });
});
