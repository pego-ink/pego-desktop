/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { AgentLogEntry } from "@/agent/use-agent-store";
import {
  emptySession,
  EMPTY_TITLE,
  fromStoredSession,
  prunedIds,
  sessionTitle,
  settleStatus,
  titleFromPrompt,
  toStoredSession,
  type SessionState,
  type SessionTurn,
} from "./session-model";

const turnOf = (log: AgentLogEntry[], status: SessionTurn["status"] = "done"): SessionTurn => ({
  runId: "r1",
  status,
  runLabel: "Claude Code",
  usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.5 },
  log,
});

describe("titles", () => {
  test("first prompt on one line, cut with an ellipsis", () => {
    expect(titleFromPrompt("  make   a\nlanding page ")).toBe("make a landing page");
    const long = titleFromPrompt("x".repeat(100));
    expect(long).toHaveLength(40);
    expect(long.endsWith("…")).toBe(true);
    expect(titleFromPrompt("   ")).toBe(EMPTY_TITLE);
  });

  test("custom title wins; an empty session is New chat", () => {
    const user: AgentLogEntry = { id: "1", at: 0, kind: "user", text: "hello there" };
    expect(sessionTitle({ customTitle: null, turns: [] })).toBe(EMPTY_TITLE);
    expect(sessionTitle({ customTitle: null, turns: [turnOf([user])] })).toBe("hello there");
    expect(sessionTitle({ customTitle: "Pricing", turns: [turnOf([user])] })).toBe("Pricing");
  });
});

describe("storage form", () => {
  const attachment = {
    id: "att-1",
    name: "a.png",
    mediaType: "image/png",
    data: "A".repeat(400),
  } as const;
  const session: SessionState = {
    ...emptySession("s1", 10),
    turns: [
      turnOf(
        [{ id: "1", at: 1, kind: "user", text: "use this", attachments: [attachment] }],
        "running",
      ),
    ],
  };

  test("drops image data, keeps name and size, settles a run that never ended", () => {
    const stored = toStoredSession(session, "doc-1", 99);
    expect(stored).toMatchObject({ id: "s1", docId: "doc-1", title: "use this", updatedAt: 99 });
    expect(stored.turns[0]?.status).toBe("cancelled");
    expect(stored.turns[0]?.log[0]?.attachments).toEqual([{ name: "a.png", size: 300 }]);
    expect(JSON.stringify(stored)).not.toContain("AAAA");
  });

  test("round trip restores the metadata for the bubble", () => {
    const back = fromStoredSession(toStoredSession(session, "doc-1", 99));
    expect(back.turns[0]?.log[0]).toMatchObject({
      text: "use this",
      attachmentsMeta: [{ name: "a.png" }],
    });
    expect(back.turns[0]?.log[0]?.attachments).toBeUndefined();
  });

  test("keeps a typed title as custom and an automatic one derived", () => {
    expect(
      fromStoredSession(toStoredSession({ ...session, customTitle: "Mine" }, "d", 1)).customTitle,
    ).toBe("Mine");
    expect(fromStoredSession(toStoredSession(session, "d", 1)).customTitle).toBeNull();
  });

  test("keeps only the newest turns", () => {
    const many = {
      ...session,
      turns: Array.from({ length: 60 }, (_, i) => ({ ...turnOf([]), runId: `r${i}` })),
    };
    const stored = toStoredSession(many, "d", 1);
    expect(stored.turns).toHaveLength(40);
    expect(stored.turns.at(-1)?.runId).toBe("r59");
  });
});

describe("settleStatus and pruning", () => {
  test("active statuses become cancelled", () => {
    expect(
      ["planning", "running", "awaiting_decision"].map((s) => settleStatus(s as never)),
    ).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(settleStatus("done")).toBe("done");
    expect(settleStatus("failed")).toBe("failed");
  });

  test("prunedIds returns everything beyond the newest N", () => {
    const metas = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, title: "t", updatedAt: i }));
    expect(prunedIds(metas, 3).sort()).toEqual(["s0", "s1"]);
    expect(prunedIds(metas, 10)).toEqual([]);
  });
});
