import { describe, expect, it } from "bun:test";
import {
  isTypingTarget,
  nextRowIndex,
  normalizeCustomAnswer,
  optionIndexForKey,
} from "@/panels/agent/decision-input";

describe("optionIndexForKey", () => {
  it("maps 1-4 to indexes", () => {
    expect(optionIndexForKey({ key: "1" }, 4)).toBe(0);
    expect(optionIndexForKey({ key: "4" }, 4)).toBe(3);
  });
  it("ignores keys beyond the option count", () => {
    expect(optionIndexForKey({ key: "3" }, 2)).toBeNull();
    expect(optionIndexForKey({ key: "0" }, 4)).toBeNull();
  });
  it("ignores non-digits and modified keys", () => {
    expect(optionIndexForKey({ key: "a" }, 4)).toBeNull();
    expect(optionIndexForKey({ key: "1", metaKey: true }, 4)).toBeNull();
    expect(optionIndexForKey({ key: "2", ctrlKey: true }, 4)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("detects text fields", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("lets buttons and body through", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("custom answer", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeCustomAnswer("  tambah   harga \n")).toBe("tambah harga");
  });
  it("rejects empty input", () => {
    expect(normalizeCustomAnswer("   ")).toBeNull();
  });
});

describe("nextRowIndex", () => {
  it("wraps around", () => {
    expect(nextRowIndex(0, -1, 5)).toBe(4);
    expect(nextRowIndex(4, 1, 5)).toBe(0);
    expect(nextRowIndex(1, 1, 5)).toBe(2);
  });
});
