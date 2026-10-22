import { describe, expect, test } from "bun:test";
import type { AgentLogEntry } from "@/agent/use-agent-store";
import { collapseRuns, countFailed, groupLog, toolDetail } from "@/panels/agent/tool-groups";

let seq = 0;
const tool = (name: string, isError = false, text = ""): AgentLogEntry => ({
  id: `t${++seq}`,
  at: 0,
  kind: "tool",
  text,
  tool: { name, isError },
});
const say = (text: string): AgentLogEntry => ({ id: `a${++seq}`, at: 0, kind: "assistant", text });

describe("groupLog", () => {
  test("merges consecutive tool entries, split by other kinds", () => {
    const a = tool("get_document");
    const b = tool("batch_design");
    const c = tool("get_document");
    const items = groupLog([a, b, say("hi"), c]);
    expect(items.map((i) => i.type)).toEqual(["tools", "entry", "tools"]);
    const first = items[0];
    expect(first?.type === "tools" && first.id).toBe(a.id);
    expect(first?.type === "tools" && first.calls).toEqual([a, b]);
  });

  test("empty log", () => expect(groupLog([])).toEqual([]));
});

describe("summaries", () => {
  test("countFailed", () => {
    expect(countFailed([tool("a"), tool("b", true), tool("c", true)])).toBe(2);
  });

  test("toolDetail hides text equal to the name", () => {
    expect(toolDetail(tool("a", false, "a"))).toBe("");
    expect(toolDetail(tool("a", false, "  "))).toBe("");
    expect(toolDetail(tool("a", false, "3 nodes"))).toBe("3 nodes");
  });

  test("collapseRuns merges consecutive repeats only when outcome matches", () => {
    const runs = collapseRuns([tool("a"), tool("a"), tool("a", true), tool("b"), tool("a")]);
    expect(runs.map((r) => [r.name, r.count, r.failed])).toEqual([
      ["a", 2, false],
      ["a", 1, true],
      ["b", 1, false],
      ["a", 1, false],
    ]);
  });
});
