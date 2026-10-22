/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { parseNumber, roundTo } from "./parse-number";
import { parseHex, toColorInputValue } from "./color";

describe("parseNumber", () => {
  test("parses plain, signed and decimal input", () => {
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber(" -3.5 ")).toBe(-3.5);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("50%")).toBe(50);
    expect(parseNumber("90°")).toBe(90);
  });
  test("rejects empty and invalid input", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("1e999")).toBeNull();
    expect(parseNumber("12px")).toBeNull();
  });
  test("clamps to bounds", () => {
    expect(parseNumber("150", { min: 0, max: 100 })).toBe(100);
    expect(parseNumber("-5", { min: 0 })).toBe(0);
  });
  test("roundTo removes float noise", () => {
    expect(roundTo(0.1 + 0.2)).toBe(0.3);
  });
});

describe("color helpers", () => {
  test("parseHex normalises", () => {
    expect(parseHex("0e7c5a")).toBe("#0E7C5A");
    expect(parseHex("#abc")).toBe("#ABC");
    expect(parseHex("#12345678")).toBe("#12345678");
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("red")).toBeNull();
  });
  test("toColorInputValue expands short forms and drops alpha", () => {
    expect(toColorInputValue("#abc")).toBe("#aabbcc");
    expect(toColorInputValue("#11223344")).toBe("#112233");
    expect(toColorInputValue(undefined)).toBe("#000000");
  });
});
