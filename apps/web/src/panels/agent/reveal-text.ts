/** Pure timing helpers for the progressive reveal of assistant text. */

/** Per-word delay of the reveal. */
export const REVEAL_MS_PER_WORD = 25;
/** The whole reveal never takes longer than this, however long the text is. */
export const REVEAL_MAX_MS = 900;
/** Very short replies still get a perceptible sweep. */
export const REVEAL_MIN_MS = 200;
/** Height of the soft leading edge of the sweep, in px. */
export const REVEAL_EDGE_PX = 24;

export const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Time to reveal `words` new words: ~25ms each, clamped to [200ms, 900ms]. */
export const revealDurationMs = (words: number): number =>
  Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, Math.round(words * REVEAL_MS_PER_WORD)));

/** Px per ms needed to cover `remainingPx` in `durationMs`. */
export const revealRate = (remainingPx: number, durationMs: number): number =>
  Math.max(0, remainingPx) / Math.max(1, durationMs);

/** Next sweep position after `dtMs`, never past `target`. */
export const revealAdvance = (revealed: number, target: number, dtMs: number, rate: number) =>
  Math.min(target, revealed + rate * Math.max(0, dtMs));

/** The sweep is done once its soft edge has passed the bottom of the content. */
export const revealTarget = (contentHeight: number): number => contentHeight + REVEAL_EDGE_PX;

/** Line height of assistant text (`leading-5`). */
export const LINE_PX = 20;
/** A reply collapses past this many rendered lines. */
export const COLLAPSE_LINES = 8;
export const COLLAPSE_MAX_PX = COLLAPSE_LINES * LINE_PX;

/** Collapse only when at least two lines would be hidden, so "Show more" never hides one line. */
export const shouldCollapse = (contentHeight: number): boolean =>
  contentHeight > COLLAPSE_MAX_PX + 2 * LINE_PX;

/** The part of the content that is on screen: a folded reply only shows its first lines. */
export const visibleHeight = (contentHeight: number, expanded: boolean): number =>
  !expanded && shouldCollapse(contentHeight) ? COLLAPSE_MAX_PX : contentHeight;
