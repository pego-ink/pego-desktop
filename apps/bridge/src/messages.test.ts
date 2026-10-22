import { describe, expect, test } from "bun:test";
import { parseEditorMessage } from "./messages";

const ok = (value: unknown) => parseEditorMessage(JSON.stringify(value));

describe("parseEditorMessage", () => {
  test("accepts every valid message type", () => {
    expect(ok({ type: "hello", protocol: 1, documentName: "a" }).ok).toBe(true);
    expect(ok({ type: "tool_result", callId: "c1", content: "x", isError: false }).ok).toBe(true);
    expect(ok({ type: "run_start", runId: "r1", prompt: "hi" }).ok).toBe(true);
    expect(ok({ type: "run_cancel", runId: "r1" }).ok).toBe(true);
  });
  test("rejects bad shapes", () => {
    expect(ok({ type: "hello", protocol: "1", documentName: "a" }).ok).toBe(false);
    expect(ok({ type: "tool_result", callId: "", content: "x", isError: false }).ok).toBe(false);
    expect(ok({ type: "tool_result", callId: "c", content: 1, isError: false }).ok).toBe(false);
    expect(ok({ type: "run_start", runId: "r", prompt: "" }).ok).toBe(false);
    expect(ok({ type: "nope" }).ok).toBe(false);
    expect(ok(null).ok).toBe(false);
    expect(ok("str").ok).toBe(false);
  });
  test("rejects invalid JSON and binary", () => {
    expect(parseEditorMessage("{not json").ok).toBe(false);
    expect(parseEditorMessage(Buffer.from("{}")).ok).toBe(false);
  });

  describe("tool_result images", () => {
    const png = { mediaType: "image/png", data: "iVBORw0KGgo=", width: 10, height: 10 };
    const result = (images: unknown) =>
      ok({ type: "tool_result", callId: "c", content: "x", isError: false, images });

    test("accepts good images and empty list", () => {
      expect(result([png]).ok).toBe(true);
      expect(result([]).ok).toBe(true);
      expect(result([png, png, png, png]).ok).toBe(true);
    });
    test("rejects bad base64, media type and dimensions", () => {
      expect(result([{ ...png, data: "***" }]).ok).toBe(false);
      expect(result([{ ...png, data: "abc" }]).ok).toBe(false);
      expect(result([{ ...png, data: "data:image/png;base64,AAAA" }]).ok).toBe(false);
      expect(result([{ ...png, mediaType: "image/jpeg" }]).ok).toBe(false);
      expect(result([{ ...png, width: 0 }]).ok).toBe(false);
      expect(result([{ ...png, height: 1.5 }]).ok).toBe(false);
    });
    test("rejects more than 4 images", () => {
      expect(result([png, png, png, png, png]).ok).toBe(false);
    });
    test("rejects more than 8MB of image bytes in total", () => {
      const big = { ...png, data: "A".repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3 / 4) * 4) };
      expect(result([big]).ok).toBe(true);
      expect(result([big, big]).ok).toBe(false);
    });
  });
});
