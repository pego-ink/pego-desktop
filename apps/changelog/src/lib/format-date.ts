const long = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Oct 23, 2026". Entry dates are calendar days, so UTC keeps them stable on any server. */
export const formatDate = (date: Date) => long.format(date);

/** "2026-10-23" for the datetime attribute. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
