/** Roving-focus target for the settings tablist (wraps around); null for keys it ignores. */
export const moveTabFocus = (current: number, key: string, count: number): number | null => {
  if (count <= 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
};
