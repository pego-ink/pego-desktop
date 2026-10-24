/**
 * Tints for parallel runs: each running session gets its own color for its canvas focus box and
 * cursor, so the user can tell which agent is working where. Slot 0 is the agent grape, so a
 * single run looks exactly as before. One slot per agent name (agent/agent-names), so each name
 * keeps its color.
 */
export const RUN_COLORS = [
  "#8D6BFF",
  "#7CC4FF",
  "#6EDBA6",
  "#FFBE6B",
  "#FFD36B",
  "#5ED3CF",
  "#FF9480",
  "#B5E36B",
  "#9AA8FF",
  "#E7C08A",
] as const;

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
