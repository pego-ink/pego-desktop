/** Distance (px) from the bottom within which the log counts as "at the bottom". */
export const PIN_THRESHOLD = 24;

type ScrollMetrics = { scrollHeight: number; scrollTop: number; clientHeight: number };

/** True when the scroll position is at (or within `threshold` px of) the bottom. */
export const isNearBottom = (
  { scrollHeight, scrollTop, clientHeight }: ScrollMetrics,
  threshold = PIN_THRESHOLD,
): boolean => scrollHeight - scrollTop - clientHeight <= threshold;
