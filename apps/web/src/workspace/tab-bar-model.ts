/** Pure helpers behind the tab bar: reorder maths, tab stepping and keyboard shortcut parsing. */

export type TabRect = { left: number; width: number };

/** `items` with the entry at `from` moved to index `to`. */
export const moveItem = <T>(items: readonly T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item as T);
  return next;
};

/**
 * Index the dragged tab would drop at: the number of other tabs whose centre lies left of the
 * dragged tab's centre (`dx` is how far the pointer moved since the drag started).
 */
export const dropIndex = (rects: readonly TabRect[], from: number, dx: number): number => {
  const dragged = rects[from];
  if (!dragged) return from;
  const centre = dragged.left + dragged.width / 2 + dx;
  return rects.reduce(
    (count, rect, i) => (i !== from && rect.left + rect.width / 2 < centre ? count + 1 : count),
    0,
  );
};

/** Horizontal shift of a tab other than the dragged one while the drag would drop at `to`. */
export const dragShift = (
  index: number,
  from: number,
  to: number,
  draggedWidth: number,
): number => {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -draggedWidth;
  if (from > to && index >= to && index < from) return draggedWidth;
  return 0;
};

/** Next or previous tab id, wrapping. Without an active tab it starts from the first or last. */
export const adjacentTab = (
  ids: readonly string[],
  activeId: string | null,
  step: 1 | -1,
): string | null => {
  if (ids.length === 0) return null;
  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index === -1) return (step === 1 ? ids[0] : ids[ids.length - 1]) ?? null;
  return ids[(index + step + ids.length) % ids.length] ?? null;
};

/** Cmd+1..8 go to that tab, Cmd+9 always the last one (like browsers). */
export const tabIdForDigit = (digit: number, ids: readonly string[]): string | null => {
  if (digit < 1 || digit > 9 || ids.length === 0) return null;
  if (digit === 9) return ids[ids.length - 1] ?? null;
  return ids[digit - 1] ?? null;
};

export type TabShortcut =
  | { kind: "new" }
  | { kind: "close" }
  | { kind: "step"; step: 1 | -1 }
  | { kind: "goto"; digit: number };

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/**
 * Tab shortcut for a keydown: Cmd/Ctrl+T new, Cmd/Ctrl+W close, Ctrl(+Shift)+Tab next/previous,
 * Cmd/Ctrl+1..9 go to a tab. Null for anything else.
 */
export const tabShortcut = (e: KeyEventLike, isMac: boolean): TabShortcut | null => {
  if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
    return { kind: "step", step: e.shiftKey ? -1 : 1 };
  }
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey && key === "t") return { kind: "new" };
  if (!e.shiftKey && key === "w") return { kind: "close" };
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : undefined);
  if (digit && !e.shiftKey) return { kind: "goto", digit: Number(digit) };
  return null;
};
