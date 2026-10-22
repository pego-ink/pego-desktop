import type { SessionMeta } from "@/agent/sessions/session-model";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "short" });
const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/** "Just now", "5 min. ago", "3 hr. ago", "2 days ago", then a plain date after a week. */
export const formatRelativeTime = (timestamp: number, now: number = Date.now()): string => {
  const age = Math.max(0, now - timestamp);
  if (age < MINUTE) return "Just now";
  if (age < HOUR) return relative.format(-Math.floor(age / MINUTE), "minute");
  if (age < DAY) return relative.format(-Math.floor(age / HOUR), "hour");
  if (age < 7 * DAY) return relative.format(-Math.floor(age / DAY), "day");
  return shortDate.format(timestamp);
};

/** Sessions whose title contains the query (case-insensitive); an empty query keeps all. */
export const filterSessions = (items: readonly SessionMeta[], query: string): SessionMeta[] => {
  const needle = query.trim().toLowerCase();
  return needle ? items.filter((item) => item.title.toLowerCase().includes(needle)) : [...items];
};
