import { describe, expect, test } from "bun:test";
import { createMapState, describeRunFailure, mapSdkMessage } from "./run-events";

const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { role: "assistant", content },
  ...extra,
});

describe("mapSdkMessage", () => {
  test("maps text, tool start and tool finish with bare tool names", () => {
    const state = createMapState();
    expect(
      mapSdkMessage(
        assistant([
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Adding a frame" },
          { type: "tool_use", id: "tu1", name: "mcp__pego__insert_nodes", input: {} },
        ]),
        state,
      ),
    ).toEqual([
      { kind: "text", text: "Adding a frame" },
      { kind: "tool", tool: "insert_nodes", status: "started" },
    ]);
    expect(
      mapSdkMessage(
        {
          type: "user",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok", is_error: true }],
          },
        },
        state,
      ),
    ).toEqual([{ kind: "tool", tool: "insert_nodes", status: "finished", isError: true }]);
  });

  test("ignores sub-agent messages and unrelated types", () => {
    const state = createMapState();
    expect(
      mapSdkMessage(assistant([{ type: "text", text: "x" }], { parent_tool_use_id: "p" }), state),
    ).toEqual([]);
    expect(mapSdkMessage({ type: "system", subtype: "init" }, state)).toEqual([]);
  });

  test("success result emits usage (incl. cache tokens) then done", () => {
    expect(
      mapSdkMessage(
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "done",
          total_cost_usd: 0.0123,
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
            output_tokens: 40,
          },
        },
        createMapState(),
      ),
    ).toEqual([
      { kind: "usage", inputTokens: 115, outputTokens: 40, costUsd: 0.0123 },
      { kind: "done" },
    ]);
  });

  test("error result emits usage then error; auth errors get the login hint", () => {
    const events = mapSdkMessage(
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Invalid API key · Please run /login",
        total_cost_usd: 0,
        usage: {},
      },
      createMapState(),
    );
    expect(events[1]).toEqual({
      kind: "error",
      message: "Claude Code is not logged in. Run `claude` once in a terminal to log in.",
    });
    const maxTurns = mapSdkMessage(
      { type: "result", subtype: "error_max_turns", is_error: true, errors: [], usage: {} },
      createMapState(),
    );
    expect(maxTurns[1]).toEqual({ kind: "error", message: "error_max_turns" });
  });

  test("assistant auth error becomes one error event; the result does not repeat it", () => {
    const state = createMapState();
    expect(mapSdkMessage(assistant([], { error: "authentication_failed" }), state)).toEqual([
      {
        kind: "error",
        message: "Claude Code is not logged in. Run `claude` once in a terminal to log in.",
      },
    ]);
    const after = mapSdkMessage(
      { type: "result", subtype: "success", is_error: true, result: "Invalid API key", usage: {} },
      state,
    );
    expect(after.map((e) => e.kind)).toEqual(["usage"]);
  });
});

describe("describeRunFailure", () => {
  test("maps spawn and auth failures", () => {
    expect(describeRunFailure(new Error("spawn claude ENOENT"))).toContain("`claude` CLI");
    expect(describeRunFailure(new Error("401 authentication_error"))).toContain("log in");
    expect(describeRunFailure("boom")).toBe("boom");
  });
});
