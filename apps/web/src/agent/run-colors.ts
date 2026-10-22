/**
 * Tints for parallel runs: each running session gets its own color for its canvas focus box and
 * cursor, so the user can tell which agent is working where. Slot 0 is the editor accent, so a
 * single run looks exactly as before.
 */
export const RUN_COLORS = ["#B79CFF", "#7CC4FF", "#6EDBA6", "#FFBE6B"] as const;

/** Dark ink that reads on every tint above (cursor pill text). */
export const RUN_INK = "#1B1230";

export const runColor = (index: number): string =>
  RUN_COLORS[((index % RUN_COLORS.length) + RUN_COLORS.length) % RUN_COLORS.length]!;

/**
 * Lowest palette slot not used by another running session. When every slot is taken (more runs
 * than colors), colors repeat starting from slot 0.
 */
export const pickColorIndex = (
  used: Iterable<number>,
  size: number = RUN_COLORS.length,
): number => {
  const taken = new Set(used);
  for (let index = 0; index < size; index++) if (!taken.has(index)) return index;
  return taken.size % size;
};
