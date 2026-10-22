/// <reference types="bun" />
import { expect, test } from "bun:test";
import { commonValue } from "./mixed-value";

test("single and equal values are shared", () => {
  expect(commonValue([5])).toEqual({ kind: "same", value: 5 });
  expect(commonValue(["a", "a", "a"])).toEqual({ kind: "same", value: "a" });
});

test("differing values are mixed", () => {
  expect(commonValue([1, 2])).toEqual({ kind: "mixed" });
  expect(commonValue([1, 1, 2])).toEqual({ kind: "mixed" });
});

test("undefined counts as a value, empty input is mixed", () => {
  expect(commonValue([undefined, undefined])).toEqual({ kind: "same", value: undefined });
  expect(commonValue([undefined, 0])).toEqual({ kind: "mixed" });
  expect(commonValue([])).toEqual({ kind: "mixed" });
});
