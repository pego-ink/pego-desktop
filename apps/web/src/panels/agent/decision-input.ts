/** Pure helpers for the decision card: number keys and custom answers. */

/** Number keys 1-4 pick the matching option. Returns the option index or null. */
export const optionIndexForKey = (
  event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
  optionCount: number,
): number | null => {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  const index = Number(event.key) - 1;
  return index < optionCount ? index : null;
};

/** True when keystrokes belong to a text field, so number keys must not pick an option. */
export const isTypingTarget = (
  el: { tagName?: string; isContentEditable?: boolean } | null,
): boolean => {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/** The custom answer to send, or null when it is empty. */
export const normalizeCustomAnswer = (text: string): string | null => {
  const answer = text.trim().replace(/\s+/g, " ");
  return answer.length > 0 ? answer : null;
};

/** Wrap-around arrow navigation between rows. */
export const nextRowIndex = (current: number, delta: 1 | -1, count: number): number =>
  count <= 0 ? 0 : (current + delta + count) % count;
