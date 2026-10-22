/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { addStop, convertFill, kindOfFill } from "./fill-kind";

describe("fill kinds", () => {
  test("solid to gradient keeps the color as the first stop, and back", () => {
    const linear = convertFill("#FF0000", "linear");
    expect(linear).toEqual({
      type: "linear",
      angle: 180,
      stops: [
        { color: "#FF0000", position: 0 },
        { color: "#FFFFFF", position: 1 },
      ],
    });
    expect(convertFill(linear!, "solid")).toBe("#FF0000");
    expect(kindOfFill(convertFill(linear!, "radial")!)).toBe("radial");
  });

  test("image needs a file", () => {
    expect(convertFill("#000", "image")).toBeNull();
  });

  test("addStop inserts between the last two stops", () => {
    expect(
      addStop([
        { color: "#000", position: 0 },
        { color: "#FFF", position: 1 },
      ]),
    ).toEqual([
      { color: "#000", position: 0 },
      { color: "#FFF", position: 0.5 },
      { color: "#FFF", position: 1 },
    ]);
  });
});
