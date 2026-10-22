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
});
