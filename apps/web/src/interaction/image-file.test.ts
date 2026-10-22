import { describe, expect, test } from "bun:test";
import { MAX_EMBED_SIDE, placementSize, scaleDownToFit } from "@/interaction/image-file";

describe("scaleDownToFit", () => {
  test("never enlarges", () => {
    expect(scaleDownToFit({ width: 300, height: 200 }, 800)).toEqual({ width: 300, height: 200 });
  });
  test("shrinks the longest side, keeping the ratio", () => {
    expect(scaleDownToFit({ width: 5120, height: 2560 }, MAX_EMBED_SIDE)).toEqual({
      width: 2560,
      height: 1280,
    });
    expect(scaleDownToFit({ width: 1000, height: 4000 }, 800)).toEqual({ width: 200, height: 800 });
  });
  test("keeps at least one pixel", () => {
    expect(scaleDownToFit({ width: 10000, height: 1 }, 800)).toEqual({ width: 800, height: 1 });
  });
});

describe("placementSize", () => {
  test("caps the longest side at 800", () => {
    expect(placementSize({ width: 1600, height: 900 })).toEqual({ width: 800, height: 450 });
    expect(placementSize({ width: 120, height: 80 })).toEqual({ width: 120, height: 80 });
  });
});
