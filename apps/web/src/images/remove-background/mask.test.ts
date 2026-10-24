import { describe, expect, test } from "bun:test";
import { hex, maskToAlpha, toInputTensor } from "./mask";

describe("toInputTensor", () => {
  test("planar RGB, scaled and normalized with the ImageNet mean and deviation", () => {
    // 2x2: red, green, blue, white.
    const rgba = Uint8ClampedArray.from([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const tensor = toInputTensor(rgba, 2);
    expect(tensor).toHaveLength(12);
    // R plane: red pixel is 1 -> (1 - 0.485) / 0.229.
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(tensor[1]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    // G plane starts after 4 values; the green pixel is the second.
    expect(tensor[4 + 1]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    // B plane: the blue pixel is the third.
    expect(tensor[8 + 2]).toBeCloseTo((1 - 0.406) / 0.225, 5);
  });
});

describe("maskToAlpha", () => {
  test("stretches the map to 0..255", () => {
    expect(Array.from(maskToAlpha([2, 3, 6]))).toEqual([0, 64, 255]);
  });

  test("a flat map does not divide by zero", () => {
    expect(Array.from(maskToAlpha([0.5, 0.5]))).toEqual([0, 0]);
  });
});

test("hex digest", () => {
  expect(hex(Uint8Array.from([0, 15, 255]).buffer)).toBe("000fff");
});
