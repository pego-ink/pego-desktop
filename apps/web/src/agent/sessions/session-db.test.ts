/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  createMemorySessionBackend,
  deleteSession,
  getSession,
  listSessions,
  saveSession,
  setSessionBackend,
} from "./session-db";
import type { StoredSession } from "./session-model";

const stored = (id: string, docId: string, updatedAt: number): StoredSession => ({
  id,
  docId,
  title: id,
  titleCustom: false,
  createdAt: updatedAt,
  updatedAt,
  turns: [],
});

beforeEach(() => {
  setSessionBackend(createMemorySessionBackend());
});

describe("session db", () => {
  test("lists a file's sessions newest first and keeps files apart", async () => {
    await saveSession(stored("a", "d1", 1));
    await saveSession(stored("b", "d1", 3));
    await saveSession(stored("c", "d2", 2));
    expect((await listSessions("d1")).map((s) => s.id)).toEqual(["b", "a"]);
    expect((await listSessions("d2")).map((s) => s.id)).toEqual(["c"]);
  });

  test("prunes to the newest 50 per file", async () => {
    for (let i = 0; i < 52; i++) await saveSession(stored(`s${i}`, "d1", i));
    await saveSession(stored("other", "d2", 0));
    const list = await listSessions("d1");
    expect(list).toHaveLength(50);
    expect(list.at(-1)?.id).toBe("s2");
    expect(await getSession("s0")).toBeNull();
    expect(await getSession("other")).not.toBeNull();
  });

  test("delete removes one session; storage errors never throw", async () => {
    await saveSession(stored("a", "d1", 1));
    await deleteSession("a");
    expect(await getSession("a")).toBeNull();
    setSessionBackend({
      listByDoc: async () => Promise.reject(new Error("no idb")),
      get: async () => Promise.reject(new Error("no idb")),
      put: async () => Promise.reject(new Error("no idb")),
      remove: async () => Promise.reject(new Error("no idb")),
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await listSessions("d1")).toEqual([]);
      expect(await saveSession(stored("x", "d1", 1))).toEqual([]);
      await deleteSession("x");
    } finally {
      console.warn = warn;
    }
  });
});
