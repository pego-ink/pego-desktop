import { describe, expect, test } from "bun:test";
import { SHIFT_TOOL_KEYS, TOOL_KEYS } from "@/store/use-tool-store";
import { SHORTCUT_GROUPS, filterShortcuts, formatKeyToken, type Chord } from "./shortcut-catalog";

const allChords = (): Chord[] =>
  SHORTCUT_GROUPS.flatMap((g) => g.entries.flatMap((e) => [...e.chords]));
const has = (chord: Chord) =>
  allChords().some((c) => c.length === chord.length && c.every((t, i) => t === chord[i]));

describe("catalog completeness", () => {
  test("every TOOL_KEYS key is listed", () => {
    for (const key of Object.keys(TOOL_KEYS)) expect(has([key.toUpperCase()])).toBe(true);
  });
  test("every SHIFT_TOOL_KEYS key is listed", () => {
    for (const key of Object.keys(SHIFT_TOOL_KEYS))
      expect(has(["shift", key.toUpperCase()])).toBe(true);
  });
  test("entry ids are unique", () => {
    const ids = SHORTCUT_GROUPS.flatMap((g) => g.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("lists the documented non-tool shortcuts", () => {
    for (const chord of [
      ["mod", "Z"],
      ["mod", "shift", "Z"],
      ["mod", "Y"],
      ["mod", "D"],
      ["mod", "A"],
      ["mod", "O"],
      ["mod", "S"],
      ["mod", "shift", "S"],
      ["alt", "1"],
      ["alt", "2"],
      ["mod", ","],
      ["shift", "1"],
      ["shift", "0"],
      ["1"],
      ["4"],
    ] satisfies Chord[])
      expect(has(chord)).toBe(true);
  });
});

describe("formatKeyToken", () => {
  test("mac symbols", () => expect(formatKeyToken("mod", true)).toBe("⌘"));
  test("other platforms", () => {
    expect(formatKeyToken("mod", false)).toBe("Ctrl");
    expect(formatKeyToken("alt", false)).toBe("Alt");
  });
  test("literal keys pass through", () => expect(formatKeyToken("Z", true)).toBe("Z"));
});

describe("filterShortcuts", () => {
  test("empty query returns everything", () =>
    expect(filterShortcuts("  ")).toHaveLength(SHORTCUT_GROUPS.length));
  test("matches by label", () => {
    const labels = filterShortcuts("redo").flatMap((g) => g.entries.map((e) => e.label));
    expect(labels).toEqual(["Redo"]);
  });
  test("matches by key on either platform", () => {
    expect(filterShortcuts("⌘ s").flatMap((g) => g.entries.map((e) => e.id))).toContain(
      "file.save",
    );
    expect(filterShortcuts("ctrl shift s").flatMap((g) => g.entries.map((e) => e.id))).toContain(
      "file.save-as",
    );
  });
  test("no match returns no groups", () => expect(filterShortcuts("zzzzqq")).toEqual([]));
});
