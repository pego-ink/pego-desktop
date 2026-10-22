export type NumberBounds = { min?: number; max?: number };

/** Round to at most `digits` decimals, killing float noise (0.1 + 0.2). */
export const roundTo = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const clampNumber = (value: number, { min, max }: NumberBounds = {}): number =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

/**
 * Parse user input from a number field. Returns null for empty or invalid input
 * so callers can revert. Accepts a trailing `%` or `°` and a comma decimal separator.
 */
export const parseNumber = (input: string, bounds: NumberBounds = {}): number | null => {
  const cleaned = input.trim().replace(/[%°]$/, "").trim().replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return clampNumber(roundTo(value, 2), bounds);
};

/** Text shown in a number field (no trailing zeros). */
export const formatNumber = (value: number, digits = 2): string => String(roundTo(value, digits));
