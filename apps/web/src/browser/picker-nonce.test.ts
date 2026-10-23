import { describe, expect, test } from "bun:test";
import { createPickerNonce, hasPickerNonce } from "./picker-nonce";
import { pickerStartScript } from "./page-scripts";

describe("picker nonce", () => {
  test("nonces are random hex that the start script accepts", () => {
    const a = createPickerNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(createPickerNonce()).not.toBe(a);
    expect(pickerStartScript(a)).toContain(JSON.stringify(a));
    expect(() => pickerStartScript('x"; evil()')).toThrow();
  });

  test("only messages with the armed nonce pass", () => {
    expect(hasPickerNonce({ type: "picked", nonce: "abc" }, "abc")).toBe(true);
    expect(hasPickerNonce({ type: "picked", nonce: "abd" }, "abc")).toBe(false);
    expect(hasPickerNonce({ type: "picked" }, "abc")).toBe(false);
    expect(hasPickerNonce({ type: "picked", nonce: "abc" }, undefined)).toBe(false);
    expect(hasPickerNonce("picked", "abc")).toBe(false);
  });
});
