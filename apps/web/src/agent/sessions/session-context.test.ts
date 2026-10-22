/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { buildHistoryBlock, HISTORY_LIMITS, promptWithHistory } from "./session-context";
import type { SessionTurn } from "./session-model";

let seq = 0;
const turn = (prompt: string, reply: string | null, status: SessionTurn["status"] = "done") =>
  ({
    runId: `run-${++seq}`,
    status,
    runLabel: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    log: [
      { id: "u", at: 0, kind: "user", text: prompt },
      {
        id: "t",
        at: 0,
        kind: "tool",
        text: "get_document",
        tool: { name: "get_document", isError: false },
      },
      ...(reply === null ? [] : [{ id: "a", at: 0, kind: "assistant" as const, text: reply }]),
    ],
  }) satisfies SessionTurn;

describe("buildHistoryBlock", () => {
  test("empty without turns", () => {
    expect(buildHistoryBlock([])).toBe("");
  });

  test("lists user prompts and final replies oldest first", () => {
    const block = buildHistoryBlock([
      turn("make a card", "Card built."),
      turn("make it red", "Done."),
    ]);
    expect(block).toBe(
      "Earlier in this session (oldest first):\nUser: make a card\nPego: Card built.\nUser: make it red\nPego: Done.",
    );
  });

  test("uses the last assistant entry as the reply, ignoring decision answers", () => {
    const t = turn("a", "first");
    t.log.push({ id: "x", at: 0, kind: "user", text: "→ option 1" });
    t.log.push({ id: "y", at: 0, kind: "assistant", text: "final" });
    expect(buildHistoryBlock([t])).toContain("User: a\nPego: final");
    expect(buildHistoryBlock([t])).not.toContain("option 1");
  });

  test("says so when a run produced no reply", () => {
    expect(buildHistoryBlock([turn("a", null, "failed")])).toContain("Pego: (the run failed)");
    expect(buildHistoryBlock([turn("a", null, "cancelled")])).toContain("(the run was cancelled)");
    expect(buildHistoryBlock([turn("a", null)])).toContain("Pego: (no reply)");
  });

  test("keeps only the last maxTurns turns", () => {
    const turns = Array.from({ length: 12 }, (_, i) => turn(`prompt ${i}`, `reply ${i}`));
    const block = buildHistoryBlock(turns);
    expect(block).not.toContain("prompt 3\n");
    expect(block).toContain("prompt 4\n");
    expect(block).toContain("prompt 11\n");
    expect(block.match(/^User:/gm)).toHaveLength(HISTORY_LIMITS.maxTurns);
  });

  test("truncates long prompts and replies", () => {
    const block = buildHistoryBlock([turn("p".repeat(2000), "r".repeat(5000))]);
    expect(block.length).toBeLessThan(
      HISTORY_LIMITS.maxPromptChars + HISTORY_LIMITS.maxReplyChars + 100,
    );
    expect(block).toContain("…");
  });

  test("stays within the total cap, squeezing older replies before newer ones", () => {
    const turns = Array.from({ length: 8 }, (_, i) => turn(`prompt ${i}`, `${i}`.repeat(1200)));
    const block = buildHistoryBlock(turns);
    expect(block.length).toBeLessThanOrEqual(HISTORY_LIMITS.maxChars);
    // The newest reply survives whole; the oldest turns are the ones that shrank or went away.
    expect(block).toContain("7".repeat(1200));
    expect(block).not.toContain("0".repeat(1200));
  });
});

describe("promptWithHistory", () => {
  test("returns the bare prompt without history", () => {
    expect(promptWithHistory("hi", "")).toBe("hi");
    expect(promptWithHistory("hi", undefined)).toBe("hi");
  });

  test("puts the history block before the current request", () => {
    expect(promptWithHistory("hi", "Earlier…")).toBe("Earlier…\n\nCurrent request:\nhi");
  });
});
