export type PanelWidthConfig = {
  defaultWidth: number;
  min: number;
  max: number;
  /** Upper bound as a fraction of the viewport width. */
  maxViewportRatio: number;
};

/** Effective max for the current viewport; never below `min`. */
export const resolveMax = (config: PanelWidthConfig, viewportWidth: number): number =>
  Math.max(config.min, Math.min(config.max, Math.floor(viewportWidth * config.maxViewportRatio)));

export const clampWidth = (width: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, width)));

/** Parse a persisted value; returns null when missing or not a finite number. */
export const parseStoredWidth = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Pixels moved per arrow key press. */
export const keyboardStep = (shiftKey: boolean): number => (shiftKey ? 64 : 16);
