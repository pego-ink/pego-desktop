import { describe, expect, test } from "bun:test";
import { paragraphKey } from "./measure-text";

type Parts = Parameters<typeof paragraphKey>[0];
const parts = (italic: boolean): Parts => [
  "hi",
  "#000",
  14,
  400,
  italic,
  "left",
  "Inter",
  undefined,
];

describe("paragraphKey", () => {
  test("italic changes the key", () => {
    expect(paragraphKey(parts(false))).not.toBe(paragraphKey(parts(true)));
  });
  test("is stable for equal inputs", () => {
    expect(paragraphKey(parts(true))).toBe(paragraphKey(parts(true)));
  });
});
