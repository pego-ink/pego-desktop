/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { filterSessions, formatRelativeTime } from "./session-format";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

describe("formatRelativeTime", () => {
  test("buckets from seconds to a week, then a date", () => {
    expect(formatRelativeTime(NOW - 20_000, NOW)).toBe("Just now");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toContain("5 min");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toContain("3 hr");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toContain("2 days");
    expect(formatRelativeTime(NOW - 30 * 86_400_000, NOW)).toMatch(/Sep/);
  });

  test("a clock-skewed future timestamp reads as just now", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("Just now");
  });
});

describe("filterSessions", () => {
  const items = [
    { id: "1", title: "Landing page", updatedAt: 3 },
    { id: "2", title: "Pricing table", updatedAt: 2 },
  ];
  test("case-insensitive contains; empty keeps all", () => {
    expect(filterSessions(items, "PRIC").map((i) => i.id)).toEqual(["2"]);
    expect(filterSessions(items, "  ").map((i) => i.id)).toEqual(["1", "2"]);
    expect(filterSessions(items, "zzz")).toEqual([]);
  });
});
